/** @jsx LiveReact.createElement */
/**
 * ASCII cinema. A lipase (PDB 1LBS, chain A) turns as a cartoon coloured
 * along its sequence, while part of the frame is rasterized into a character
 * grid. Each cell averages the scene beneath it: its brightness picks a
 * density glyph from a 5×7 bitmap font, sharp edges pick a contour stroke
 * along the edge, and the glyph is inked in the cell's own colour. A slider
 * sweeps the boundary between the character grid and the smooth render, with
 * a dithered band where the two dissolve into each other.
 *
 * Molecular data and representations are molgpu's; the character grid is this
 * file's own full-screen WGSL pass over a built-in bitmap font.
 */
import {
  gather,
  type LC,
  type LiveElement,
  React as LiveReact,
  render,
  unmount,
  use,
  useMemo,
  useResource,
} from "@use-gpu/live";
import { AutoCanvas } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  getShader,
  OrbitCamera,
  Pass,
  RawFullScreen,
  RenderTarget,
  RenderToTexture,
  useShaderRef,
} from "@use-gpu/workbench";
import { useAnimationFrame } from "@use-gpu/frame";
import { wgsl } from "@use-gpu/shader/wgsl";
import type { OffscreenRenderContext } from "@use-gpu/core";
import { coordinateBounds, type StructureData } from "@molgpu/table";
import { chain, resolve } from "@molgpu/select";
import { bySeq } from "@molgpu/fields";
import { Cartoon, Structure } from "@molgpu/viewer";
import lipaseUrl from "../../../packages/io/test/fixtures/1lbs.bcif?url";
import { loadStructure } from "../demos/data.ts";
import { SharedWebGPU } from "../demos/viewer.tsx";
import type { Experiment } from "../pages/experiments.tsx";

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// ── Bitmap font ─────────────────────────────────────────────────────────────

/** 5×7 bitmaps, rows top-down, MSB left. Index 0 is blank; 1–8 are the
 * density ramp, 9–12 the contour strokes. */
const GLYPHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0b00100], // .
  [0, 0, 0b00100, 0, 0, 0b00100, 0], // :
  [0, 0, 0, 0b01110, 0, 0, 0], // -
  [0, 0, 0b11111, 0, 0b11111, 0, 0], // =
  [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0], // +
  [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0], // *
  [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010], // #
  [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01111], // @
  [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100], // |
  [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000], // /
  [0, 0, 0, 0b11111, 0, 0, 0], // ─
  [0b10000, 0b01000, 0b01000, 0b00100, 0b00010, 0b00010, 0b00001], // \
];
const RAMP = 9; // glyphs 0–8 are the density ramp

// Emitted verbatim into the shader below; `wgsl` string-joins its tokens.
const FONT = `
var<private> GLYPHS: array<array<u32, 7>, ${GLYPHS.length}> = array(
${
  GLYPHS.map((rows) => `  array(${rows.map((b) => `${b}u`).join(", ")}),`).join(
    "\n",
  )
}
);
`;

/** Scene clear colour, linear. The character grid's paper is the same, so
 * the two halves share one background and the dither band is invisible
 * where there is no molecule. */
const CLEAR = [0.006, 0.008, 0.016];

const ASCII = wgsl`
${FONT}
@link fn getScene(uv: vec2<f32>) -> vec4<f32>;
@link fn getSplit() -> f32;
@link fn getCells() -> vec2<f32>;

const BG = vec3<f32>(${CLEAR.map((c) => c.toFixed(4)).join(", ")});

// Vignette, ACES tone map and sRGB encode, shared by both halves.
fn tone(c: vec3<f32>, uv: vec2<f32>) -> vec3<f32> {
  let p = uv - vec2<f32>(0.5);
  var x = c * (1.0 - 0.8 * dot(p, p));
  x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
  return select(1.055 * pow(x, vec3<f32>(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3<f32>(0.0031308));
}

// Coverage-weighted brightness of a colour above the background.
fn ink(c: vec3<f32>) -> f32 {
  let d = max(c - BG, vec3<f32>(0.0));
  return 1.0 - exp(-max(d.r, max(d.g, d.b)) * 2.2);
}

// The scene averaged over one cell (4 taps), so thin strands still register.
fn cellColor(cell: vec2<f32>, step: vec2<f32>) -> vec3<f32> {
  let q = step * 0.25;
  return (getScene(cell + vec2<f32>(-q.x, -q.y)).rgb + getScene(cell + vec2<f32>(q.x, -q.y)).rgb +
          getScene(cell + vec2<f32>(-q.x, q.y)).rgb + getScene(cell + q).rgb) * 0.25;
}

@export fn getAscii(uv: vec2<f32>) -> vec4<f32> {
  let step = vec2<f32>(1.0) / getCells();
  let grid = floor(uv / step);
  let cell = (grid + vec2<f32>(0.5)) * step;
  let c = cellColor(cell, step);
  let l = ink(c);

  // Density glyph from brightness; on a strong edge, a stroke along it.
  var glyph = min(u32(pow(l, 0.8) * ${String(RAMP)}.0), ${String(RAMP - 1)}u);
  let gx = ink(cellColor(cell + vec2<f32>(step.x, 0.0), step)) - ink(cellColor(cell - vec2<f32>(step.x, 0.0), step));
  let gy = ink(cellColor(cell + vec2<f32>(0.0, step.y), step)) - ink(cellColor(cell - vec2<f32>(0.0, step.y), step));
  if (l > 0.08 && length(vec2<f32>(gx, gy)) > 0.7) {
    // The edge runs across the gradient; fold its angle into 4 directions.
    let a = (atan2(gy, gx) + 3.14159265) * 4.0 / 3.14159265;
    let q = u32(round(a)) % 4u;
    glyph = 9u + q;
  }

  // The bitmap sits in a 6×9 box per cell, leaving a column and row gap.
  let f = fract(uv / step);
  let px = u32(f.x * 6.0);
  let py = i32((1.0 - f.y) * 9.0) - 1;
  var bit = 0u;
  if (px < 5u && py >= 0 && py < 7) {
    bit = (GLYPHS[glyph][u32(py)] >> (4u - px)) & 1u;
  }
  // Ink in the cell's own hue, lifted so dim strands stay legible.
  let hue = c / max(max(c.r, max(c.g, c.b)), 1e-4);
  let lit = hue * (0.6 + 1.6 * l);
  let ascii = tone(mix(BG, lit, f32(bit)), uv);
  let soft = tone(getScene(uv).rgb, uv);

  // Left of the split is characters; across a band either side of it,
  // cells dissolve between the two on a per-cell random threshold.
  let w = 8.0 * step.x;
  let t = clamp((uv.x - getSplit()) / w * 0.5 + 0.5, 0.0, 1.0);
  let r = fract(sin(dot(grid, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  return vec4<f32>(select(soft, ascii, r >= t), 1.0);
}
`;

const HDR = {
  format: "rgba16float" as GPUTextureFormat,
  colorSpace: "linear" as const,
  sampler: {
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  } as GPUSamplerDescriptor,
};

/** Renders `children` into an HDR target, then the character grid onto the
 * canvas. */
const AsciiCinema: LC<{
  scene: OffscreenRenderContext;
  split: number;
  children?: LiveElement;
}> = ({ scene, split, children }) => {
  const cells = useMemo<Vec2>(() => [
    Math.max(8, Math.round(scene.width / 9)),
    Math.max(6, Math.round(scene.height / 15)),
  ], [scene.width, scene.height]);
  const cellsRef = useShaderRef(cells);
  const splitRef = useShaderRef(split);
  const shader = useMemo(
    () => getShader(ASCII, [scene.source, splitRef, cellsRef]),
    [scene.source],
  );
  return [
    use(RenderToTexture, { target: scene, children }),
    use(Pass, {
      mode: "fullscreen",
      children: use(RawFullScreen, { texture: shader as never }),
    }),
  ];
};

// ── Scene ───────────────────────────────────────────────────────────────────

/** N to C terminus: indigo, violet, rose, coral, amber. */
const SUNSET = [
  [0, [0.22, 0.32, 0.95, 1]],
  [0.3, [0.58, 0.3, 0.92, 1]],
  [0.55, [0.95, 0.32, 0.55, 1]],
  [0.8, [1, 0.55, 0.28, 1]],
  [1, [1, 0.82, 0.36, 1]],
] as const;

/** `frozen` holds time (screenshots); otherwise t runs from `origin`. */
type Clock = {
  origin: number;
  speed: number;
  frozen: number | null;
  split: number;
};

const Stage: LC<{ host: string; data: StructureData; clock: Clock }> = (
  { host, data, clock },
) => {
  useAnimationFrame();
  const t = clock.frozen ??
    (performance.now() - clock.origin) / 1000 * clock.speed;
  // Chain A alone: its bounds centre the camera, its residues span the
  // palette (1LBS has six copies; the whole entry would off-centre it).
  const { focus, center, color } = useMemo(() => {
    const focus = resolve(chain("A"), data);
    // Polymer rows only: chain A's waters sit far past its last residue.
    const { residue } = data.topology.atoms;
    const { polymer } = data.topology.residues;
    const rows = Array.from(focus.indices, (i) => residue[i])
      .filter((row) => polymer[row] !== "other");
    return {
      focus,
      center: coordinateBounds(data, focus.indices)!.center as Vec3,
      color: bySeq({
        domain: [Math.min(...rows), Math.max(...rows)],
        stops: SUNSET,
      }),
    };
  }, [data]);
  useReadout(host, clock.split);
  return gather(
    [use(RenderTarget, {
      ...HDR,
      label: "ascii:scene",
      backgroundColor: [...CLEAR, 1],
    })],
    (targets: OffscreenRenderContext[]) => (
      <AsciiCinema scene={targets[0]} split={clock.split}>
        <OrbitCamera
          target={center}
          radius={62 + 5 * Math.sin(t * 0.2)}
          bearing={0.5 + t * 0.25}
          pitch={0.3 + 0.12 * Math.sin(t * 0.31)}
        >
          <Pass lights>
            <AmbientLight color={[0.55, 0.6, 1]} intensity={0.35} />
            <DirectionalLight
              direction={[-0.5, -0.6, -1]}
              color={[1, 0.95, 0.88]}
              intensity={2.2}
            />
            <DirectionalLight
              direction={[0.8, 0.3, 0.6]}
              color={[0.5, 0.7, 1]}
              intensity={0.8}
            />
            <Structure data={data}>
              <Cartoon
                select={focus}
                color={color}
                material={{ type: "pbr", roughness: 0.45 }}
              />
            </Structure>
          </Pass>
        </OrbitCamera>
      </AsciiCinema>
    ),
  );
};

/** Published on the host for tests and screenshots. */
const useReadout = (host: string, split: number) =>
  useResource(() => {
    const element = document.querySelector<HTMLElement>(host);
    if (!element) return;
    element.dataset.webgpu = "ready";
    element.dataset.split = String(Math.round(split * 100));
  }, [host, split]);

const Root: LC<{ host: string; data: StructureData; clock: Clock }> = (props) =>
  use(SharedWebGPU, {
    fallback: (error: unknown) => {
      const element = document.querySelector<HTMLElement>(props.host);
      if (element) {
        element.dataset.webgpu = "failed";
        const status = document.querySelector("[data-webgpu-error]");
        if (status) status.textContent = String(error);
      }
    },
    children: use(AutoCanvas, {
      selector: props.host,
      backgroundColor: [0, 0, 0, 1],
      children: use(Stage, props),
    }),
  });

export const experiment: Experiment = {
  title: "ASCII cinema",
  summary:
    "A turning lipase cartoon set in coloured terminal characters on the left, its smooth render on the right, dissolving into each other where they meet.",
  mount(element, params) {
    const host = `#${element.id}`;
    // ?split=<0..100> sets the boundary, ?t=<s> the start time, ?speed=<x>
    // scales rotation and ?freeze holds it: for tests and screenshots.
    const start = Number(params.get("t") ?? 0) || 0;
    const clock: Clock = {
      origin: performance.now() - start * 1000,
      speed: Number(params.get("speed") ?? 1) || 1,
      frozen: params.has("freeze") ? start : null,
      split: clamp01(Number(params.get("split") ?? 50) / 100),
    };
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(clock.split * 100));
    slider.setAttribute("aria-label", "ASCII split");
    slider.oninput = () => {
      clock.split = Number(slider.value) / 100;
    };
    element.append(slider);
    let fiber: ReturnType<typeof render> | null = null;
    let live = true;
    void loadStructure(lipaseUrl, "Lipase B (1LBS)").then((data) => {
      if (live) fiber = render(use(Root, { host, data, clock }));
    });
    return () => {
      live = false;
      if (fiber) unmount(fiber);
      slider.remove();
    };
  },
};
