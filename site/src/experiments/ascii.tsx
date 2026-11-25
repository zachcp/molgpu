/** @jsx LiveReact.createElement */
/**
 * ASCII cinema. A lipase (PDB 1LBS, chain A) rotates while part of the frame
 * is rasterized into a character grid: cell luminance picks a density glyph
 * from a 5×7 bitmap font, luminance edges pick a contour glyph in the
 * gradient's direction. A slider sweeps the boundary between the character
 * grid and the smooth render, with a dithered band of interleaved cells where
 * they meet.
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
import { f32, u32, wgsl } from "@use-gpu/shader/wgsl";
import type { OffscreenRenderContext } from "@use-gpu/core";
import { coordinateBounds, type StructureData } from "@molgpu/table";
import { chain } from "@molgpu/select";
import { Structure, Tube } from "@molgpu/viewer";
import lipaseUrl from "../../../packages/io/test/fixtures/1lbs.bcif?url";
import { loadStructure } from "../demos/data.ts";
import { SharedWebGPU } from "../demos/viewer.tsx";
import type { Experiment } from "../pages/experiments.tsx";

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mixRgb = (
  a: Rgba,
  b: Rgba,
  t: number,
): Rgba => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  1,
];

// ── Bitmap font ─────────────────────────────────────────────────────────────

/** 5×7 bitmaps, rows top-down, MSB left. Index 0 is blank; 1–8 are the
 * density ramp, 9–12 the contour strokes. */
const GLYPHS: number[][] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0b01000], // .
  [0, 0, 0, 0b00100, 0, 0, 0b00100], // :
  [0, 0, 0, 0b01110, 0, 0, 0], // -
  [0, 0, 0b01110, 0, 0b01110, 0, 0], // =
  [0, 0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100], // +
  [0, 0b01010, 0b00100, 0b11111, 0b00100, 0b01010, 0], // *
  [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010], // #
  [0b11000, 0b11001, 0b00010, 0b00100, 0b01000, 0b10011, 0b00011], // %
  [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110], // @
  [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100], // |
  [0b00001, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0b10000], // /
  [0b10000, 0b01000, 0b00100, 0b00100, 0b00010, 0b00001, 0b00001], // \
];

// Emitted verbatim into the shader below; `wgsl` string-joins its tokens.
const FONT = `
var<private> GLYPHS: array<array<u32, 7>, ${GLYPHS.length}> = array(
${
  GLYPHS.map((rows) => `  array(${rows.map((bits) => `${bits}u`).join(", ")}),`)
    .join("\n")
}
);
`;

const RAMP = 9;

const ASCII = wgsl`
${FONT}
@link fn getScene(uv: vec2<f32>) -> vec4<f32>;
@link fn getSplit() -> f32;
@link fn getCells() -> vec2<f32>;

// Tone-mapped luminance of one scene sample.
const EXPOSURE = 1.6;
fn light(uv: vec2<f32>) -> f32 {
  let c = getScene(uv).rgb;
  return 1.0 - exp(-max(c.r, max(c.g, c.b)) * EXPOSURE);
}

@export fn getAscii(uv: vec2<f32>) -> vec4<f32> {
  let cells = getCells();
  let step = vec2<f32>(1.0) / cells;
  let grid = floor(uv / step);
  let cell = (grid + vec2<f32>(0.5)) * step;

  // Luminance gradient across neighbouring cells: a contour glyph in the
  // gradient's direction, or a density glyph from the cell's own light.
  let gx = light(cell + vec2<f32>(step.x, 0.0)) - light(cell - vec2<f32>(step.x, 0.0));
  let gy = light(cell + vec2<f32>(0.0, step.y)) - light(cell - vec2<f32>(0.0, step.y));
  var glyph = clamp(u32(pow(light(cell), 0.65) * ${f32(RAMP)}), 0u, ${
  u32(RAMP - 1)
});
  if (length(vec2<f32>(gx, gy)) > 0.4) {
    // Quadrants of the gradient angle: -, /, |, \.
    let q = (u32(round(atan2(gy, gx) * 4.0 / 3.14159265)) + 4) % 4;
    glyph = select(select(select(3u, 11u, q == 1u), 10u, q == 2u), 12u, q == 3u);
  }

  // Sample the 5×7 bitmap inside the cell; lit phosphor on near-black.
  let f = fract(uv / step);
  let row = u32((1.0 - f.y) * 7.0);
  let bit = (GLYPHS[glyph][row] >> (4 - u32(f.x * 5.0))) & 1u;
  let l = pow(light(cell), 0.65);
  let phosphor = vec3<f32>(0.25, 1.0, 0.45) * (0.3 + 0.7 * l);
  var ascii = mix(vec3<f32>(0.002, 0.006, 0.003), phosphor, f32(bit));
  let alo = ascii * 12.92;
  let ahi = 1.055 * pow(ascii, vec3<f32>(1.0 / 2.4)) - 0.055;
  ascii = select(ahi, alo, ascii <= vec3<f32>(0.0031308));

  // Right of the split the smooth render stays; a dithered band of columns
  // interleaves the two where they meet.
  let split = getSplit();
  var left = uv.x < split;
  if (abs(uv.x - split) < 6.0 * step.x) {
    left = (grid.x + grid.y) % 2.0 < 1.0;
  }

  let p = uv - vec2<f32>(0.5);
  var graded = getScene(uv).rgb * (1.0 - 0.85 * dot(p, p));
  graded = clamp((graded * (2.51 * graded + 0.03)) / (graded * (2.43 * graded + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
  let lo = graded * 12.92;
  let hi = 1.055 * pow(graded, vec3<f32>(1.0 / 2.4)) - 0.055;
  graded = select(hi, lo, graded <= vec3<f32>(0.0031308));
  return vec4<f32>(select(graded, ascii, left), 1.0);
}
`;

const LINEAR: GPUSamplerDescriptor = {
  minFilter: "linear",
  magFilter: "linear",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
};
const HDR = {
  format: "rgba16float" as GPUTextureFormat,
  colorSpace: "linear" as const,
  sampler: LINEAR,
};
const SCENE_CLEAR = [0.004, 0.006, 0.008, 1];

/** Renders `children` into an HDR target, then the character grid onto the
 * canvas. `split` moves live through the shared state ref. */
const AsciiCinema: LC<{
  scene: OffscreenRenderContext;
  split: number;
  children?: LiveElement;
}> = ({ scene, split, children }) => {
  const cells = useMemo<Vec2>(() => [
    Math.max(8, Math.round(scene.width / 10)),
    Math.max(6, Math.round(scene.height / 18)),
  ], [scene.width, scene.height]);
  const cellsRef = useShaderRef(cells);
  const splitRef = useShaderRef(split);
  const shader = getShader(ASCII, [scene.source, splitRef, cellsRef]);
  return [
    use(RenderToTexture, { target: scene, children }),
    use(Pass, {
      mode: "fullscreen",
      children: use(RawFullScreen, { texture: shader as never }),
    }),
  ];
};

// ── Scene ───────────────────────────────────────────────────────────────────

const GROWN: Rgba = [1.0, 1.9, 1.3, 1];
const PHOSPHOR: Rgba = [0.5, 2.0, 0.9, 1];

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
  const center = useMemo(
    () => coordinateBounds(data)!.center as Vec3,
    [data],
  );
  useReadout(host, clock.split);
  const phosphor = mixRgb(GROWN, PHOSPHOR, 0.5 + 0.5 * Math.sin(t * 0.7));
  return gather(
    [use(RenderTarget, {
      ...HDR,
      label: "ascii:scene",
      backgroundColor: SCENE_CLEAR,
    })],
    (targets: OffscreenRenderContext[]) => (
      <AsciiCinema scene={targets[0]} split={clock.split}>
        <OrbitCamera
          target={center}
          radius={64 + 6 * Math.sin(t * 0.2)}
          bearing={0.5 + t * 0.16}
          pitch={0.25 + 0.08 * Math.sin(t * 0.31)}
        >
          <Pass lights>
            <AmbientLight color={[0.5, 0.7, 1]} intensity={0.55} />
            <DirectionalLight
              direction={[-0.6, -0.5, -1]}
              color={[1, 0.95, 0.85]}
              intensity={2.8}
            />
            <DirectionalLight
              direction={[0.7, 0.4, 1]}
              color={[0.4, 1, 0.7]}
              intensity={1.1}
            />
            <Structure data={data}>
              <Tube
                select={chain("A")}
                radius={0.5}
                color={phosphor}
                material={{ type: "pbr", roughness: 0.4 }}
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
    element.dataset.mode = split <= 0
      ? "render"
      : split >= 1
      ? "ascii"
      : "split";
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
    "A rotating lipase rasterized into chunky terminal characters on the left, its smooth render on the right, and a dithered band where they meet.",
  mount(element, params) {
    const host = `#${element.id}`;
    // ?split=<0..100> sets the boundary, ?speed=<x> scales rotation and
    // ?freeze holds it: for tests and screenshots.
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
