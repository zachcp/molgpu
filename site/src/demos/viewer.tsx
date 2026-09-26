import { render, use, useResource, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useMouseState,
  useWheelState,
} from "@use-gpu/workbench";
import type { StructureData } from "@molgpu/table";
import { Structure, TimelineProvider } from "@molgpu/viewer";

export type Scene = (data: StructureData) => unknown;

const clamp = (value: number, lower: number, upper: number) =>
  Math.max(lower, Math.min(upper, value));

/** Controlled camera state driven by AutoCanvas's mouse, wheel, and touch events. */
const OrbitControls = (
  {
    host,
    bearing: initialBearing,
    pitch: initialPitch,
    radius: initialRadius,
    target,
    children,
  }: {
    host: string;
    bearing: number;
    pitch: number;
    radius: number;
    target: [number, number, number];
    children: unknown;
  },
) => {
  const [bearing, setBearing] = useState(initialBearing);
  const [pitch, setPitch] = useState(initialPitch);
  const [radius, setRadius] = useState(initialRadius);
  const mouse = useMouseState();
  const wheel = useWheelState();
  useResource(() => {
    if (!mouse.buttons.left) return;
    setBearing((value) => value - mouse.moveX * 0.01);
    setPitch((value) => clamp(value - mouse.moveY * 0.01, -1.5, 1.5));
    document.querySelector<HTMLElement>(host)?.setAttribute(
      "data-orbit",
      "dragging",
    );
  }, [mouse]);
  useResource(() => {
    if (!wheel.moveY) return;
    setRadius((value) =>
      clamp(value * Math.exp(wheel.moveY * 0.002), 0.5, 5000)
    );
    document.querySelector<HTMLElement>(host)?.setAttribute(
      "data-orbit",
      "zooming",
    );
  }, [wheel]);
  return use(OrbitCamera, {
    bearing,
    pitch,
    radius,
    target,
    children: children as never,
  });
};

export const mountViewer = (
  host: string,
  data: StructureData,
  scene: Scene,
  camera: { radius: number; target: [number, number, number] },
  options: {
    worldLight?: boolean;
    oit?: boolean;
    time?: number;
    postprocess?: boolean;
  } = {},
) => {
  render(use(WebGPU, {
    fallback: (error: unknown) => {
      const status = document.querySelector<HTMLElement>("[data-webgpu-error]");
      if (status) {
        status.textContent = `WebGPU is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      return null;
    },
    children: use(AutoCanvas, {
      selector: host,
      samples: 4,
      backgroundColor: [0.035, 0.055, 0.09, 1],
      children: use(OrbitControls, {
        host,
        ...camera,
        bearing: 0.6,
        pitch: 0.28,
        children: use(Pass, {
          lights: true,
          oit: options.oit,
          ...(options.postprocess
            ? {
              ssao: 0.35,
              outline: { outer: 1.5, inner: 0, color: [0.02, 0.03, 0.05, 0.6] },
            }
            : {}),
          children: [
            use(AmbientLight, {
              color: [0.7, 0.8, 1],
              intensity: options.worldLight ? 0.1 : 0.35,
            }),
            use(DirectionalLight, {
              direction: [-1, -2, -1.5],
              color: [1, 0.95, 0.88],
              intensity: options.worldLight ? 1.8 : 1.25,
            }),
            use(TimelineProvider, {
              time: options.time ?? 0,
              children: use(Structure, {
                data,
                children: scene(data) as never,
              }),
            }),
          ],
        }),
      }),
    }),
  }));
};
