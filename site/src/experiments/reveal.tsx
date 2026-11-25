// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
/** Two registered views of 6CUN, revealed without rebuilding either scene. */
import {
  gather,
  type LC,
  React as LiveReact,
  render,
  unmount,
  use,
  useMemo,
  useResource,
  useState,
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
  useRenderContext,
  useShaderRef,
} from "@use-gpu/workbench";
import { OrbitControls } from "@use-gpu/interact";
import type { OffscreenRenderContext } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import { coordinateBounds, type StructureData } from "@molgpu/table";
import { comp, protein, resolve } from "@molgpu/select";
import { attribute, categorical } from "@molgpu/fields";
import { BallAndStick, Cartoon, Spacefill, Structure } from "@molgpu/viewer";
import structureUrl from "../../assets/6cun.bcif?url";
import { loadStructure } from "../demos/data.ts";
import { SharedWebGPU } from "../demos/viewer.tsx";
import type { Experiment } from "../pages/experiments.tsx";

const PROTEIN = protein();
const HEME = comp(["HEC"]);
const CARBENE = comp(["CA1"]);
// Sage carbon, slate nitrogen and brick oxygen retain element distinctions
// without the saturated mint / primary-colour contrast of the first sketch.
const ELEMENTS = categorical(attribute("element"), {
  1: [0.58, 0.57, 0.53, 1],
  6: [0.24, 0.29, 0.26, 1],
  7: [0.21, 0.27, 0.36, 1],
  8: [0.43, 0.24, 0.22, 1],
  16: [0.52, 0.43, 0.26, 1],
  26: [0.46, 0.31, 0.21, 1],
}, [0.4, 0.42, 0.39, 1]);
const MATTE = { type: "pbr", roughness: 0.88, metalness: 0 } as const;

const REVEAL = wgsl`
@link fn getAtoms(uv: vec2<f32>) -> vec4<f32>;
@link fn getCartoon(uv: vec2<f32>) -> vec4<f32>;
@link fn getSplit() -> f32;

@export fn reveal(uv: vec2<f32>) -> vec4<f32> {
  // Both targets have the same full-frame projection: never stretch a half.
  let c = select(getCartoon(uv), getAtoms(uv), uv.x < getSplit()).rgb;
  let mapped = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
  let srgb = select(1.055 * pow(mapped, vec3<f32>(1.0 / 2.4)) - 0.055, mapped * 12.92, mapped <= vec3<f32>(0.0031308));
  return vec4<f32>(srgb, 1.0);
}
`;

const Composite: LC<{
  targets: OffscreenRenderContext[];
  handle: HTMLElement;
  host: HTMLElement;
}> = ({ targets, handle, host }) => {
  // Only the composite subscribes: dragging never rerenders the scene tree.
  const [split, setSplit] = useState(0.5);
  useResource((dispose) => {
    const input = () =>
      setSplit(Number(handle.getAttribute("aria-valuenow")) / 100);
    handle.addEventListener("input", input);
    dispose(() => handle.removeEventListener("input", input));
    host.dataset.webgpu = "ready";
  }, [handle, host]);
  const boundary = useShaderRef(split);
  const shader = useMemo(() =>
    getShader(REVEAL, [
      targets[0].source,
      targets[1].source,
      boundary,
    ]), [targets[0].source, targets[1].source]);
  return (
    <Pass mode="fullscreen">
      <RawFullScreen texture={shader as never} />
    </Pass>
  );
};

const Stage: LC<{
  data: StructureData;
  handle: HTMLElement;
  host: HTMLElement;
}> = ({ data, handle, host }) => {
  const { width, height } = useRenderContext();
  const framing = Math.max(1, height / width);
  const center = useMemo(
    () =>
      coordinateBounds(data, resolve(PROTEIN, data).indices)!.center as [
        number,
        number,
        number,
      ],
    [data],
  );
  const lights = () => [
    <AmbientLight color={[0.75, 0.78, 0.82]} intensity={0.7} />,
    <DirectionalLight
      direction={[-0.5, -0.6, -1]}
      color={[0.95, 0.93, 0.88]}
      intensity={1.65}
    />,
    <DirectionalLight
      direction={[0.7, 0.3, 0.8]}
      color={[0.7, 0.76, 0.8]}
      intensity={0.5}
    />,
  ];
  const activeSite = () => [
    <BallAndStick
      select={HEME}
      color={ELEMENTS}
      material={MATTE}
      ball={0.32}
      stick={0.18}
    />,
    <BallAndStick
      select={CARBENE}
      color={[0.58, 0.43, 0.2, 1]}
      material={MATTE}
      ball={0.48}
      stick={0.22}
    />,
  ];
  return use(OrbitControls, {
    target: center,
    radius: 60,
    bearing: 0.6,
    pitch: 0.3,
    minRadius: 15,
    maxRadius: 180,
    render: (
      radius: number,
      bearing: number,
      pitch: number,
      target: number[],
    ) => (
      <OrbitCamera
        radius={radius * framing}
        bearing={bearing}
        pitch={pitch}
        target={target}
      >
        <Structure data={data}>
          {gather(
            [0, 1].map((i) =>
              use(RenderTarget, {
                format: "rgba16float",
                colorSpace: "linear",
                backgroundColor: [0.009, 0.016, 0.024, 1],
                samples: 4,
                sampler: { minFilter: "linear", magFilter: "linear" },
                label: `reveal:${i === 0 ? "atoms" : "cartoon"}`,
              })
            ),
            (targets: OffscreenRenderContext[]) => [
              <RenderToTexture target={targets[0]}>
                <Pass lights>
                  {lights()}
                  <Spacefill
                    select={PROTEIN}
                    color={ELEMENTS}
                    material={MATTE}
                  />
                  {activeSite()}
                </Pass>
              </RenderToTexture>,
              <RenderToTexture target={targets[1]}>
                <Pass
                  lights
                  outline={{
                    outer: 2,
                    inner: 0,
                    color: [0.015, 0.04, 0.03, 1],
                  }}
                >
                  {lights()}
                  <Cartoon
                    select={PROTEIN}
                    color={[0.27, 0.33, 0.29, 1]}
                    material={MATTE}
                  />
                  {activeSite()}
                </Pass>
              </RenderToTexture>,
              <Composite targets={targets} handle={handle} host={host} />,
            ],
          )}
        </Structure>
      </OrbitCamera>
    ),
  });
};

export const experiment: Experiment = {
  title: "Two ways of seeing",
  summary:
    "Slide between full atoms and an outlined cartoon of an engineered cytochrome c, with its heme and carbene intermediate highlighted in both.",
  mount(host) {
    const overlay = document.createElement("div");
    overlay.className = "reveal-overlay";
    overlay.innerHTML = `
      <style>
        .experiment:has(.reveal-overlay) header { flex-wrap: wrap; }
        .experiment:has(.reveal-overlay) h1 { font-size: clamp(1.5rem, 4vw, 3rem); }
        .reveal-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; color: #dcefe8; }
        .reveal-caption { position: absolute; top: 22px; left: 24px; right: 24px; display: flex; justify-content: space-between; font-size: 12px; letter-spacing: .13em; text-transform: uppercase; }
        .reveal-note { position: absolute; bottom: 18px; left: 24px; right: 24px; font-size: 12px; color: #a7c1ba; line-height: 1.7; }
        .reveal-handle { position: absolute; top: 0; bottom: 0; left: 50%; width: 36px; transform: translateX(-50%); cursor: ew-resize; touch-action: none; pointer-events: auto; outline: none; }
        .reveal-handle::before { content: ''; position: absolute; top: 54px; bottom: 112px; left: 17px; width: 1px; background: #d3efdd80; }
        .reveal-handle::after { content: '‹ ›'; position: absolute; top: 48%; left: 0; width: 36px; height: 42px; display: grid; place-items: center; border: 1px solid #c5e8d9; border-radius: 8px; background: #16382ded; color: #f0fff7; font-size: 20px; }
        .reveal-handle:hover::after, .reveal-handle:focus-visible::after { background: #2c6350; }
        .reveal-handle:focus-visible::after { outline: 2px solid #f0fff7; outline-offset: 3px; }
      </style>
      <div class="reveal-caption"><span>Full atoms</span><span>Outlined cartoon</span></div>
      <div class="reveal-handle" role="slider" tabindex="0" aria-label="Representation reveal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
      <div class="reveal-note">6CUN · engineered cytochrome c<br>Heme in element colours · carbene intermediate in gold<br>Drag the divider · drag the molecule to orbit · scroll to zoom</div>`;
    const handle = overlay.querySelector<HTMLElement>(".reveal-handle")!;
    const update = (percent: number) => {
      const value = Math.max(0, Math.min(100, percent));
      handle.style.left = `${value}%`;
      handle.setAttribute("aria-valuenow", String(value));
      handle.setAttribute(
        "aria-valuetext",
        `${Math.round(value)} percent full atoms`,
      );
      handle.dispatchEvent(new Event("input"));
    };
    handle.onpointerdown = (event) => {
      if (event.button !== 0) return;
      handle.setPointerCapture(event.pointerId);
      event.stopPropagation();
      handle.focus();
    };
    handle.onpointermove = (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const bounds = host.getBoundingClientRect();
      update((event.clientX - bounds.left) / bounds.width * 100);
    };
    handle.onpointerup = (event) => {
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    };
    handle.onkeydown = (event) => {
      const current = Number(handle.getAttribute("aria-valuenow"));
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
        ? 100
        : event.key === "ArrowLeft"
        ? current - 2
        : event.key === "ArrowRight"
        ? current + 2
        : null;
      if (next === null) return;
      event.preventDefault();
      update(next);
    };
    host.append(overlay);
    let live = true;
    let fiber: ReturnType<typeof render> | null = null;
    void loadStructure(structureUrl, "Engineered cytochrome c (6CUN)").then(
      (data) => {
        if (!live) return;
        fiber = render(use(SharedWebGPU, {
          fallback: (error: unknown) => {
            host.dataset.webgpu = "error";
            document.querySelector("[data-webgpu-error]")!.textContent = String(
              error,
            );
            return null;
          },
          children: use(AutoCanvas, {
            selector: `#${host.id}`,
            backgroundColor: [0.04, 0.06, 0.08, 1],
            children: use(Stage, { data, handle, host }),
          }),
        }));
      },
    ).catch((error) => {
      if (!live) return;
      host.dataset.webgpu = "error";
      document.querySelector("[data-webgpu-error]")!.textContent = String(
        error,
      );
    });
    return () => {
      live = false;
      if (fiber) unmount(fiber);
      overlay.remove();
    };
  },
};
