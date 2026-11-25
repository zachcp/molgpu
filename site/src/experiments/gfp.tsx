// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
/**
 * Growing GFP. The backbone of green fluorescent protein (PDB 1EMA) grows as a
 * tube from the N terminus, a bright bead marking the growing end. When the
 * barrel is complete, the chromophore at its centre (CRO 66, formed from
 * Thr65-Tyr66-Gly67) lights up and the whole protein glows through a bloom.
 *
 * Molecular data and representations are molgpu's; the bloom is this file's
 * own chain of use.gpu render targets and full-screen WGSL passes.
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
  PointLight,
  RawFullScreen,
  RenderTarget,
  RenderToTexture,
  useShaderRef,
} from "@use-gpu/workbench";
import { useAnimationFrame } from "@use-gpu/frame";
import { wgsl } from "@use-gpu/shader/wgsl";
import type { OffscreenRenderContext } from "@use-gpu/core";
import { coordinateBounds, type StructureData } from "@molgpu/table";
import { comp, residues } from "@molgpu/select";
import { BallAndStick, Spacefill, Structure, Tube } from "@molgpu/viewer";
import gfpUrl from "../../../packages/io/test/fixtures/1ema.bcif?url";
import { loadStructure } from "../demos/data.ts";
import { SharedWebGPU } from "../demos/viewer.tsx";
import type { Experiment } from "../pages/experiments.tsx";

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

// ── Timeline ────────────────────────────────────────────────────────────────

const FIRST = 2, LAST = 229; // 1EMA's resolved residues (auth numbering)
const GROW = 9; // seconds for the backbone to grow
const IGNITE = 2.5; // seconds for the chromophore and bloom to come up

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const mix = (a: number[], b: number[], t: number) =>
  a.map((v, i) => v + (b[i] - v) * t);

/** Everything the scene needs at time `t` seconds. */
const timeline = (t: number) => {
  const growth = smooth(clamp01(t / GROW));
  const glow = smooth(clamp01((t - GROW) / IGNITE));
  // A slow fluorescent breathing once lit.
  const pulse = 1 + 0.15 * glow * Math.sin((t - GROW) * 2 * Math.PI / 3.5);
  return {
    head: Math.round(FIRST + growth * (LAST - FIRST)),
    growing: t < GROW,
    glow,
    pulse,
  };
};

// ── Bloom ───────────────────────────────────────────────────────────────────

/** Downsample 4×4 full-res texels and keep what exceeds a soft threshold. */
const BRIGHT = wgsl`
@link fn getScene(uv: vec2<f32>) -> vec4<f32>;
@link fn getTexel() -> vec2<f32>;
@link fn getThreshold() -> f32;
@export fn getBright(uv: vec2<f32>) -> vec4<f32> {
  let d = getTexel();
  let c = (getScene(uv + vec2<f32>(-d.x, -d.y)).rgb +
           getScene(uv + vec2<f32>(d.x, -d.y)).rgb +
           getScene(uv + vec2<f32>(-d.x, d.y)).rgb +
           getScene(uv + d).rgb) * 0.25;
  let l = max(c.r, max(c.g, c.b));
  let w = max(l - getThreshold(), 0.0) / max(l, 1e-4);
  return vec4<f32>(c * w, 1.0);
}
`;

/** One separable 9-tap Gaussian, as 5 bilinear fetches along getStep(). */
const BLUR = wgsl`
@link fn getInput(uv: vec2<f32>) -> vec4<f32>;
@link fn getStep() -> vec2<f32>;
@export fn getBlur(uv: vec2<f32>) -> vec4<f32> {
  let s = getStep();
  var c = getInput(uv).rgb * 0.2270270270;
  c += (getInput(uv + s * 1.3846153846).rgb + getInput(uv - s * 1.3846153846).rgb) * 0.3162162162;
  c += (getInput(uv + s * 3.2307692308).rgb + getInput(uv - s * 3.2307692308).rgb) * 0.0702702703;
  return vec4<f32>(c, 1.0);
}
`;

/** Scene + two bloom radii, vignette, ACES tone map, sRGB encode. */
const COMPOSITE = wgsl`
@link fn getScene(uv: vec2<f32>) -> vec4<f32>;
@link fn getNear(uv: vec2<f32>) -> vec4<f32>;
@link fn getFar(uv: vec2<f32>) -> vec4<f32>;
@link fn getStrength() -> f32;
@export fn getComposite(uv: vec2<f32>) -> vec4<f32> {
  let bloom = getNear(uv).rgb * 0.6 + getFar(uv).rgb * 0.8;
  var c = getScene(uv).rgb + bloom * getStrength();
  let p = uv - vec2<f32>(0.5);
  c *= 1.0 - 0.9 * dot(p, p);
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055;
  return vec4<f32>(select(hi, lo, c <= vec3<f32>(0.0031308)), 1.0);
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
const SCENE_CLEAR = [0.002, 0.004, 0.01, 1];

/** One full-screen draw of `shader` into `target`. */
const Filter = (
  { target, shader }: { target: OffscreenRenderContext; shader: unknown },
) =>
  use(RenderToTexture, {
    target,
    children: use(Pass, {
      mode: "fullscreen",
      children: use(RawFullScreen, { texture: shader as never }),
    }),
  });

/** Renders `children` into an HDR target, blooms what is brighter than 1. */
const Bloom: LC<{ strength: number; children?: LiveElement }> = (
  { strength, children },
) =>
  gather(
    [
      use(RenderTarget, {
        ...HDR,
        label: "gfp:scene",
        backgroundColor: SCENE_CLEAR,
      }),
      use(RenderTarget, {
        ...HDR,
        label: "gfp:bright",
        resolution: 1 / 4,
        samples: 1,
        depthStencil: null,
      }),
      use(RenderTarget, {
        ...HDR,
        label: "gfp:near",
        resolution: 1 / 4,
        samples: 1,
        depthStencil: null,
      }),
      use(RenderTarget, {
        ...HDR,
        label: "gfp:near2",
        resolution: 1 / 4,
        samples: 1,
        depthStencil: null,
      }),
      use(RenderTarget, {
        ...HDR,
        label: "gfp:far",
        resolution: 1 / 8,
        samples: 1,
        depthStencil: null,
      }),
      use(RenderTarget, {
        ...HDR,
        label: "gfp:far2",
        resolution: 1 / 8,
        samples: 1,
        depthStencil: null,
      }),
    ],
    (targets: OffscreenRenderContext[]) => {
      const [scene, bright, near, near2, far, far2] = targets;
      const texel = (
        t: OffscreenRenderContext,
        x: number,
        y: number,
      ) => [x / t.width, y / t.height];
      const sceneTexel = useShaderRef(texel(scene, 1, 1));
      const threshold = useShaderRef(1);
      // One texel per tap: the 5 bilinear fetches then sample the 9-tap
      // Gaussian exactly. Wider steps undersample it into boxy streaks.
      const nearH = useShaderRef(texel(near, 1, 0));
      const nearV = useShaderRef(texel(near, 0, 1));
      const farH = useShaderRef(texel(far, 1, 0));
      const farV = useShaderRef(texel(far, 0, 1));
      const gain = useShaderRef(strength);
      const shaders = useMemo(() => ({
        bright: getShader(BRIGHT, [scene.source, sceneTexel, threshold]),
        nearH: getShader(BLUR, [bright.source, nearH]),
        nearV: getShader(BLUR, [near.source, nearV]),
        down: getShader(BLUR, [near2.source, farH]),
        farH: getShader(BLUR, [far2.source, farH]),
        farV: getShader(BLUR, [far.source, farV]),
        composite: getShader(COMPOSITE, [
          scene.source,
          near2.source,
          far2.source,
          gain,
        ]),
      }), targets);
      return [
        use(RenderToTexture, { target: scene, children }),
        use(Filter, { target: bright, shader: shaders.bright }),
        use(Filter, { target: near, shader: shaders.nearH }),
        use(Filter, { target: near2, shader: shaders.nearV }),
        // The wide radius blurs twice, ping-ponging between far and far2.
        use(Filter, { target: far, shader: shaders.down }),
        use(Filter, { target: far2, shader: shaders.farV }),
        use(Filter, { target: far, shader: shaders.farH }),
        use(Filter, { target: far2, shader: shaders.farV }),
        use(Pass, {
          mode: "fullscreen",
          children: use(RawFullScreen, {
            texture: shaders.composite as never,
          }),
        }),
      ];
    },
  );

// ── Scene ───────────────────────────────────────────────────────────────────

const GROWN: Rgba = [0.16, 0.62, 0.45, 1]; // lit teal-green while growing
const GLOWING: Rgba = [0.22, 1.5, 0.6, 1]; // HDR green once fluorescent
const TIP: Rgba = [2.5, 6, 3.5, 1];
const CHROMOPHORE = comp(["CRO"]);

/** Molecular layers for one instant; queries change only with the head. */
const Gfp: LC<{ head: number; growing: boolean; glow: number; pulse: number }> =
  ({ head, growing, glow, pulse }) => {
    const grown = useMemo(() => residues([FIRST, head]), [head]);
    const tip = useMemo(() => residues([head, head]), [head]);
    const tube = mix(GROWN, GLOWING.map((c) => c * pulse), glow) as Rgba;
    const lit = glow * pulse;
    return [
      <Tube
        select={grown}
        radius={0.42}
        color={tube}
        material={{ type: "pbr", roughness: 0.35 }}
      />,
      growing && (
        <Spacefill
          select={tip}
          scale={0.38}
          color={TIP}
          material={{ type: "basic" }}
        />
      ),
      glow > 0 && (
        <BallAndStick
          select={CHROMOPHORE}
          ball={0.32}
          stick={0.2}
          color={[0.8 * lit, 7 * lit, 2 * lit, 1]}
          material={{ type: "basic" }}
        />
      ),
    ].filter(Boolean);
  };

/** Published on the host for tests and screenshots. */
const useReadout = (host: string, head: number, phase: string) =>
  useResource(() => {
    const element = document.querySelector<HTMLElement>(host);
    if (!element) return;
    element.dataset.webgpu = "ready";
    element.dataset.head = String(head);
    element.dataset.phase = phase;
  }, [host, head, phase]);

/** `frozen` holds time (screenshots); otherwise t runs from `origin`. */
type Clock = {
  origin: number;
  speed: number;
  frozen: number | null;
  bloom: boolean;
};

const Stage: LC<{ host: string; data: StructureData; clock: Clock }> = (
  { host, data, clock },
) => {
  useAnimationFrame();
  const t = clock.frozen ??
    (performance.now() - clock.origin) / 1000 * clock.speed;
  const { head, growing, glow, pulse } = timeline(t);
  useReadout(
    host,
    head,
    growing ? "growing" : glow < 1 ? "igniting" : "glowing",
  );
  const center = useMemo(
    () => coordinateBounds(data)!.center as Vec3,
    [data],
  );
  const lit = glow * pulse;
  const scene = (
    <Pass lights>
      <AmbientLight color={[0.45, 0.6, 1]} intensity={0.18} />
      <DirectionalLight
        direction={[-0.6, -0.5, -1]}
        color={[1, 0.92, 0.82]}
        intensity={1.1}
      />
      <DirectionalLight
        direction={[0.7, 0.3, 1]}
        color={[0.35, 1, 0.75]}
        intensity={0.6 + 0.6 * glow}
      />
      {lit > 0 && (
        <PointLight
          position={center}
          color={[0.35, 1, 0.55]}
          intensity={12 * lit}
        />
      )}
      <Structure data={data}>
        <Gfp head={head} growing={growing} glow={glow} pulse={pulse} />
      </Structure>
    </Pass>
  );
  return (
    <OrbitCamera
      target={center}
      radius={78 - 18 * smooth(clamp01(t / (GROW + IGNITE)))}
      bearing={0.5 + t * 0.12}
      pitch={0.22 + 0.1 * Math.sin(t * 0.25)}
    >
      {clock.bloom ? <Bloom strength={0.5 + 0.3 * glow}>{scene}</Bloom> : scene}
    </OrbitCamera>
  );
};

const Root: LC<{ host: string; data: StructureData; clock: Clock }> = (
  props,
) =>
  use(SharedWebGPU, {
    fallback: (error: unknown) => {
      const status = document.querySelector("[data-webgpu-error]");
      if (status) {
        status.textContent = `WebGPU is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      return null;
    },
    children: use(AutoCanvas, {
      selector: props.host,
      samples: 4,
      backgroundColor: [0, 0, 0, 1],
      children: use(Stage, props),
    }),
  });

export const experiment: Experiment = {
  title: "Growing GFP",
  summary:
    "Green fluorescent protein's backbone grows as a tube; once the barrel closes, the chromophore lights up and the protein glows through a bloom.",
  mount(element, params) {
    const host = `#${element.id}`;
    // ?t=<s> starts mid-way, ?speed=<x> scales time and ?freeze holds it at
    // t, and ?bloom=0 draws without the bloom: for tests and screenshots.
    const speed = Number(params.get("speed") ?? 1) || 1;
    const start = Number(params.get("t") ?? 0) || 0;
    const clock: Clock = {
      origin: performance.now() - start * 1000 / speed,
      speed,
      frozen: params.has("freeze") ? start : null,
      bloom: params.get("bloom") !== "0",
    };
    const replay = document.createElement("button");
    replay.textContent = "Replay";
    replay.onclick = () => {
      clock.origin = performance.now();
      clock.frozen = null;
    };
    element.append(replay);
    let fiber: ReturnType<typeof render> | null = null;
    let live = true;
    void loadStructure(gfpUrl, "GFP (1EMA)").then((data) => {
      if (live) fiber = render(use(Root, { host, data, clock }));
    });
    return () => {
      live = false;
      if (fiber) unmount(fiber);
      replay.remove();
    };
  },
};
