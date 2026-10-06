import {
  type LiveElement,
  provide,
  render,
  unmount,
  use,
  useAwait,
  useMemo,
  useResource,
  useState,
  wrap,
} from "@use-gpu/live";
import { AutoCanvas, getGPUAdapter, mountGPUDevice } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DeviceContext,
  DirectionalLight,
  Environment,
  LinearRGB,
  OrbitCamera,
  Pass,
  Queue,
  useMouseState,
  useWheelState,
} from "@use-gpu/workbench";
import type { StructureData } from "@molgpu/table";
import { all } from "@molgpu/select";
import {
  type CameraCurve,
  Structure,
  TimelineProvider,
  useCameraCurve,
  useCoordinateFocus,
  type ViewerElement,
} from "@molgpu/viewer";
import { useStructureResource } from "@molgpu/viewer/advanced";
import { WobbleCoordinates } from "./coordinates.ts";
import {
  figureLight,
  type FigureStage,
  GroundPlane,
  KEY_DIRECTION,
} from "./figure.ts";

export type Scene = (data: StructureData) => ViewerElement;

type ViewerOptions = {
  worldLight?: boolean;
  oit?: boolean;
  time?: number;
  postprocess?: boolean;
  coordinates?: boolean;
  /** Figure mode: ground plane, SSAO and (optionally) a shadow-mapped key light. */
  figure?: FigureStage;
  picking?: boolean;
  /** use.gpu environment preset; "none" keeps the slot so switching is a shader change. */
  environment?: "none" | "park" | "pisa" | "road" | "field";
  /**
   * Click-to-focus: the orbit target and radius follow `curve` (null holds the
   * plain camera) sampled at `time` seconds, through the same useCameraCurve
   * binding a timeline story uses.
   */
  focusCamera?: {
    curve: CameraCurve | null;
    time: number;
    /** The sampled target and radius, so the next move starts from them. */
    onPose?: (pose: { target: readonly number[]; radius: number }) => void;
  };
  /** Render into a linear RGB target and tone map to the canvas. */
  tonemap?: "linear" | "aces" | "hable" | "reinhard";
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
const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

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
  // A new initial pitch (figure mode looks down at its ground) resets the orbit.
  useResource(() => setPitch(initialPitch), [initialPitch]);
  const [zoom, setZoom] = useState(1);
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
    setZoom((value) => clamp(value * Math.exp(wheel.moveY * 0.002), 0.1, 20));
    document.querySelector<HTMLElement>(host)?.setAttribute(
      "data-orbit",
      "zooming",
    );
  }, [wheel]);
  return use(OrbitCamera, {
    bearing,
    pitch,
    radius: clamp(initialRadius * zoom, 0.5, 5000),
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

/**
 * Orbit controls whose target and radius come from a camera curve, evaluated
 * against the nearest <Structure> at the enclosing timeline's seconds. Without
 * a curve it holds the given pose (a constant two-frame curve), so starting a
 * focus move never changes the tree.
 */
const CurveOrbitControls = (
  { curve, onPose, ...props }: Parameters<typeof OrbitControls>[0] & {
    curve: CameraCurve | null;
    onPose?: (pose: { target: readonly number[]; radius: number }) => void;
  },
) => {
  const hold = useMemo<CameraCurve>(() => {
    const pose = {
      bearing: 0,
      pitch: 0,
      target: props.target,
      radius: props.radius,
    };
    return [{ time: 0, ...pose }, { time: 1, ...pose }];
  }, [props.target, props.radius]);
  // Padding keeps the focused residue's neighbours in view.
  const pose = useCameraCurve(curve ?? hold, useStructureResource(), {
    padding: 2.5,
  });
  useResource(() => {
    const host = document.querySelector<HTMLElement>(props.host);
    if (host) {
      host.dataset.focusRadius = pose.radius.toFixed(3);
      host.dataset.focusTarget = pose.target.map((v) => v.toFixed(3)).join(",");
    }
    onPose?.(pose);
  }, [pose.radius, ...pose.target]);
  return use(OrbitControls, {
    ...props,
    target: pose.target as [number, number, number],
    radius: pose.radius,
  });
};

// One live root per host. Re-rendering the same demo updates it in place (the
// canvas, GPU device and orbit state survive a scrub); a different demo
// unmounts it first so canvases never accumulate; all roots share one device.
const roots = new Map<
  string,
  {
    key: string;
    fiber: ReturnType<typeof render>;
  }
>();
const updates = new Map<string, (state: ViewerState) => void>();

// One GPUDevice for the page, shared by every demo root. use.gpu's <WebGPU>
// requests a new device per mount and never destroys it, so switching demos
// accumulated devices; on a software GPU each new request grew slower (hosted
// CI: 14 ms for the first demo, 7.5 s by the last; molgpu-sept-s5o.20).
// Same optional features as <WebGPU>.
const OPTIONAL_FEATURES: GPUFeatureName[] = [
  "rg11b10ufloat-renderable",
  "depth32float-stencil8",
  "shader-f16",
];
let sharedDevice: Promise<GPUDevice> | null = null;
const pageDevice = (): Promise<GPUDevice> =>
  sharedDevice ??= (async () => {
    const { device } = await mountGPUDevice(await getGPUAdapter(), {
      required: [],
      optional: OPTIONAL_FEATURES,
      limits: {},
    });
    void device.lost.then(() => {
      sharedDevice = null;
    });
    return device;
  })().catch((error) => {
    sharedDevice = null;
    throw error;
  });

/** <WebGPU> over the page's shared device: fresh roots, one device. */
const SharedWebGPU = (
  { fallback, children }: {
    fallback: (error: unknown) => LiveElement;
    children: LiveElement;
  },
) => {
  const [device, error] = useAwait(() => pageDevice(), []);
  useResource((dispose) => {
    if (!device) return;
    const handler = (event: Event) =>
      console.error((event as GPUUncapturedErrorEvent).error.message);
    device.addEventListener("uncapturederror", handler);
    dispose(() => device.removeEventListener("uncapturederror", handler));
  }, [device]);
  return device
    ? provide(DeviceContext, device, wrap(Queue, children))
    : error
    ? fallback(error)
    : null;
};

/**
 * Publishes the WebGPU device state on the host as `data-webgpu` (pending,
 * ready, error) with the device acquisition time in `data-webgpu-ms`, so tests
 * wait on a signal instead of a timer. Mounted inside AutoCanvas, so `ready`
 * also means the canvas exists.
 */
const GpuReady = ({ host, started }: { host: string; started: number }) => {
  useResource(() => {
    const element = document.querySelector<HTMLElement>(host);
    if (!element) return;
    element.dataset.webgpu = "ready";
    element.dataset.webgpuMs = String(Math.round(performance.now() - started));
  }, [host, started]);
  return null;
};

const ViewerRoot = (initial: ViewerState) => {
  const [state, update] = useState(initial);
  updates.set(initial.host, update);
  const { host, data, scene, camera, options } = state;
  const started = useMemo(() => performance.now(), [initial.host]);
  useResource(() => {
    const element = document.querySelector<HTMLElement>(initial.host);
    if (element) {
      element.dataset.webgpu = "pending";
      delete element.dataset.webgpuMs;
    }
  }, [initial.host]);
  return use(SharedWebGPU, {
    fallback: (error: unknown) => {
      const element = document.querySelector<HTMLElement>(host);
      if (element) element.dataset.webgpu = "error";
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
      backgroundColor: options.figure
        ? [0.22, 0.28, 0.36, 1]
        : [0.035, 0.055, 0.09, 1],
      children: [
        use(GpuReady, { host, started }),
        (() => {
          const scenePass = (insideStructure: boolean) =>
            use(Pass, {
              lights: true,
              oit: options.oit,
              picking: options.picking,
              ...(options.figure
                ? { shadows: options.figure.shadows, ssao: 0.35 }
                : {}),
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
                  intensity: options.worldLight
                    ? 0.1
                    : options.figure
                    ? 0.55
                    : 0.35,
                }),
                use(DirectionalLight, {
                  direction: KEY_DIRECTION,
                  color: [1, 0.95, 0.88],
                  intensity: options.worldLight
                    ? 1.8
                    : options.figure
                    ? 1.55
                    : 1.25,
                  ...(options.figure ? figureLight(options.figure) : {}),
                }),
                (() => {
                  const content = use(TimelineProvider, {
                    time: options.time ?? 0,
                    children: insideStructure ? scene(data) : use(Structure, {
                      data,
                      children: scene(data),
                    }),
                  });
                  return options.environment
                    ? use(Environment, {
                      preset: options.environment,
                      children: content,
                    })
                    : content;
                })(),
                options.figure ? use(GroundPlane, options.figure) : null,
              ],
            });
          const background = options.figure
            ? [0.22, 0.28, 0.36, 1]
            : [0.035, 0.055, 0.09, 1];
          // A tone-mapped view renders the pass into a linear RGB target first.
          const pass = (insideStructure: boolean) =>
            options.tonemap
              ? use(LinearRGB, {
                tonemap: options.tonemap,
                samples: 4,
                // The target is linear; the canvas clear colour is sRGB.
                backgroundColor: background.map((c, i) =>
                  i < 3 ? srgbToLinear(c) : c
                ),
                children: scenePass(insideStructure),
              })
              : scenePass(insideStructure);
          const controls = {
            host,
            ...camera,
            // Figure mode steps back to frame the ground and its shadow.
            radius: options.figure ? camera.radius * 1.35 : camera.radius,
            bearing: 0.6,
            pitch: options.figure ? 0.9 : 0.28,
          };
          if (options.focusCamera) {
            return use(Structure, {
              data,
              children: use(TimelineProvider, {
                time: options.focusCamera.time,
                children: use(CurveOrbitControls, {
                  ...controls,
                  curve: options.focusCamera.curve,
                  onPose: options.focusCamera.onPose,
                  children: pass(true),
                }),
              }),
            });
          }
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
      ],
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

/** Release the live root and its canvas when the page owning the host unmounts. */
export const disposeViewer = (host: string) => {
  const root = roots.get(host);
  if (!root) return;
  unmount(root.fiber);
  roots.delete(host);
  updates.delete(host);
};
