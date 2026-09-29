// Research only: public molecular scene with controlled replacement and unmount.
import {
  React,
  render,
  unmount,
  use,
  useMemo,
  useResource,
  useState,
  yeet,
} from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  OrbitCamera,
  Pass,
  QueueReconciler,
  RawData,
  RawFaces,
  useDeviceContext,
} from "@use-gpu/workbench";
import type { StorageSource } from "@use-gpu/core";
import { Spacefill, Structure } from "@molgpu/viewer";
import { attribute, categorical } from "@molgpu/fields";
import { structure } from "../../../packages/fields/test/fixture.ts";

void React;
const trace = (event: string) => {
  (globalThis as unknown as { __retirement: { mark: (s: string) => void } })
    .__retirement.mark(event);
};
const colors = [
  categorical(attribute("element"), {
    6: [1, 0, 0, 1],
    7: [0, 0, 1, 1],
    8: [1, 1, 0, 1],
  }, [0, 1, 0, 1]),
  categorical(attribute("bfactor"), { 10: [1, 0, 0, 1] }, [0, 1, 0, 1]),
];
const controls = {
  palette: (_n: number) => {},
  epoch: (_n: number) => {},
  visible: (_b: boolean) => {},
  tick: (_n: number) => {},
  invalidate: () => {},
  fence: () => Promise.resolve(),
  unmount: () => {},
};
Object.assign(globalThis, { __scene: controls });

// This is deliberately only a queue checkpoint, NOT a withdrawal certificate.
const Checkpoint = ({ tick }: { tick: number }) =>
  QueueReconciler.quote(yeet(() => {
    trace(`checkpoint:${tick}`);
    return null;
  }));

// Research-only native draw: the old closure captures the validity of its own
// allocation. Delayed replacement compilation can retain that closure.
const GuardedFaces = (
  { guarded }: { guarded: boolean },
) => {
  const device = useDeviceContext();
  const data = useMemo(
    () =>
      new Float32Array(
        Array.from({ length: 3 * 4 }, (_, i) =>
          i % 4 === 3 ? 1 : (i % 4 === 0 ? (i / 4) % 3 - 1 : 0)),
      ),
    [],
  );
  return use(RawData, {
    data,
    format: "vec4<f32>",
    length: 3,
    render: (source: StorageSource) =>
      use(GuardedFaceSource, { source, device, guarded }),
  });
};

const GuardedFaceSource = ({
  source,
  device,
  guarded,
}: {
  source: StorageSource;
  device: GPUDevice;
  guarded: boolean;
}) => {
  source.buffer.label = "molgpu:guarded-face:3";
  const validity = useMemo(() => ({ valid: true, retired: false }), [
    source.buffer,
  ]);
  const retire = () => {
    if (validity.retired) return;
    validity.retired = true;
    validity.valid = false;
    trace("invalidate:3");
    void device.queue.onSubmittedWorkDone().then(() => source.buffer.destroy());
  };
  controls.invalidate = retire;
  useResource((dispose) => {
    dispose(retire);
  }, [source.buffer, validity]);
  return use(RawFaces, {
    positions: source,
    count: 3,
    color: [1, 0, 0, 1],
    shaded: false,
    side: "both",
    shouldDispatch: () => {
      trace(`guard:3:${validity.valid}`);
      return !guarded || validity.valid;
    },
  });
};

const App = () => {
  const device = useDeviceContext();
  const [palette, setPalette] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [visible, setVisible] = useState(true);
  const [tick, setTick] = useState(0);
  const data = useMemo(() => structure(), [epoch]);
  Object.assign(controls, {
    palette: setPalette,
    epoch: setEpoch,
    visible: setVisible,
    tick: setTick,
    fence: () => device.queue.onSubmittedWorkDone(),
  });
  return (
    <>
      <OrbitCamera radius={20} bearing={tick * 0.01}>
        <Pass>
          {visible
            ? (new URLSearchParams(location.search).has("guarded")
              ? (
                <>
                  <GuardedFaces
                    guarded={!new URLSearchParams(location.search).has(
                      "unguarded",
                    )}
                  />
                  <RawFaces
                    position={[0, 0, 0, 1]}
                    count={3}
                    shaded={palette > 0}
                    side="both"
                  />
                </>
              )
              : (
                <Structure data={data}>
                  <Spacefill
                    color={colors[palette]}
                    material={{ type: "basic" }}
                  />
                </Structure>
              ))
            : null}
        </Pass>
      </OrbitCamera>
      <Checkpoint tick={tick} />
    </>
  );
};

let root: ReturnType<typeof render> | null = render(
  <WebGPU fallback={null}>
    <AutoCanvas selector="#root" samples={1}>
      <App />
    </AutoCanvas>
  </WebGPU>,
);
controls.unmount = () => {
  if (root) unmount(root);
  root = null;
  // Do not let test-owned setters retain disposed fibers during the GC probe.
  Object.assign(controls, {
    palette: (_n: number) => {},
    epoch: (_n: number) => {},
    visible: (_b: boolean) => {},
    tick: (_n: number) => {},
    invalidate: () => {},
    fence: () => Promise.resolve(),
    unmount: () => {},
  });
};
