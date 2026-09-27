import { render, unmount, use, useResource, useState } from "@use-gpu/live";
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
import { all } from "@molgpu/select";
import {
  Structure,
  TimelineProvider,
  useCoordinateFocus,
  type ViewerElement,
} from "@molgpu/viewer";
import { WobbleCoordinates } from "./coordinates.ts";

export type Scene = (data: StructureData) => ViewerElement;

type ViewerOptions = {
  worldLight?: boolean;
  oit?: boolean;
  time?: number;
  postprocess?: boolean;
  coordinates?: boolean;
};

type ViewerState = {
  host: string;
  data: StructureData;
  scene: Scene;
  camera: { radius: number; target: [number, number, number] };
  options: ViewerOptions;
};

const clamp = (value: number, lower: number, upper: number) =>
  Math.max(lower, Math.min(upper, value));
const ALL_ATOMS = all("atom");

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
    children: ViewerElement;
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
    children,
  });
};

const StreamOrbitControls = (
  props: Parameters<typeof OrbitControls>[0],
) => {
  const focus = useCoordinateFocus(ALL_ATOMS);
  useResource(() => {
    const host = document.querySelector<HTMLElement>(props.host);
    if (host && focus) {
      host.dataset.focusX = String(focus.target[0]);
      host.dataset.focusY = String(focus.target[1]);
    }
  }, [focus]);
  return use(OrbitControls, {
    ...props,
    target: focus?.target as [number, number, number] ?? props.target,
  });
};

// One live root per host. Re-rendering the same demo updates it in place (the
// canvas, GPU device and orbit state survive a scrub); a different demo
// unmounts it first so canvases and devices never accumulate.
const roots = new Map<
  string,
  {
    key: string;
    fiber: ReturnType<typeof render>;
  }
>();
const updates = new Map<string, (state: ViewerState) => void>();

const ViewerRoot = (initial: ViewerState) => {
  const [state, update] = useState(initial);
  updates.set(initial.host, update);
  const { host, data, scene, camera, options } = state;
  return use(WebGPU, {
    fallback: (error: unknown) => {
      const status = document.querySelector<HTMLElement>(
        "[data-webgpu-error]",
      );
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
      children: (() => {
        const pass = (insideStructure: boolean) =>
          use(Pass, {
            lights: true,
            oit: options.oit,
            ...(options.postprocess
              ? {
                ssao: 0.35,
                outline: {
                  outer: 1.5,
                  inner: 0,
                  color: [0.02, 0.03, 0.05, 0.6],
                },
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
                children: insideStructure ? scene(data) : use(Structure, {
                  data,
                  children: scene(data),
                }),
              }),
            ],
          });
        const controls = {
          host,
          ...camera,
          bearing: 0.6,
          pitch: 0.28,
        };
        return options.coordinates
          ? use(Structure, {
            data,
            children: use(WobbleCoordinates, {
              phase: options.time ?? 0,
              children: use(StreamOrbitControls, {
                ...controls,
                children: pass(true),
              }),
            }),
          })
          : use(OrbitControls, { ...controls, children: pass(false) });
      })(),
    }),
  });
};

export const mountViewer = (
  key: string,
  host: string,
  data: StructureData,
  scene: Scene,
  camera: { radius: number; target: [number, number, number] },
  options: ViewerOptions = {},
) => {
  const next = { host, data, scene, camera, options };
  const previous = roots.get(host);
  if (previous && previous.key === key) {
    updates.get(host)?.(next);
    return;
  }
  if (previous) unmount(previous.fiber);
  const fiber = render(use(ViewerRoot, next));
  roots.set(host, { key, fiber });
};
