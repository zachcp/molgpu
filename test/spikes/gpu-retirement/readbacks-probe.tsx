// Hold staging completion across owner replacement and unmount.
import { React, render, useMemo, useResource, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { useDeviceContext } from "@use-gpu/workbench";
import { Structure } from "@molgpu/viewer";
import { useCoordinateBounds } from "@molgpu/viewer/advanced";
import { resolve, where } from "@molgpu/select";
import { structure } from "../../../packages/fields/test/fixture.ts";
import { useStatusReadback } from "../../../packages/viewer/src/internal/status-readback.ts";
import { ThrottledReadback } from "../../../packages/viewer/src/internal/throttled-readback.ts";

void React;
const kind = new URLSearchParams(location.search).get("kind");
const data = structure();
const controls = {
  visible: (_b: boolean) => {},
  epoch: (_n: number) => {},
  published: 0,
  fence: () => Promise.resolve(),
};
Object.assign(globalThis, { __readbacks: controls });
const Bounds = ({ epoch }: { epoch: number }) => {
  const rows = useMemo(
    () => resolve(where("atom", `rows-${epoch}`, (_d, i) => i >= epoch), data),
    [epoch],
  );
  const result = useCoordinateBounds(rows);
  if (result) controls.published++;
  return null;
};
const Status = ({ source, bytes }: { source: GPUBuffer; bytes: number }) => {
  const device = useDeviceContext();
  const read = useStatusReadback(
    bytes,
    "readback-probe",
    () => controls.published++,
  );
  useResource(() => {
    const encoder = device.createCommandEncoder();
    const map = read(encoder, source, 1);
    device.queue.submit([encoder.finish()]);
    map?.();
  }, [source, bytes]);
  return null;
};
const Source = ({ epoch }: { epoch: number }) => {
  const device = useDeviceContext();
  const bytes = 16 + epoch * 16;
  const source = useMemo(() => {
    const buffer = device.createBuffer({
      size: bytes,
      usage: 0x4 | 0x8,
      label: "molgpu:readback-probe:source",
    });
    device.queue.writeBuffer(buffer, 0, new Float32Array(bytes / 4).fill(42));
    return buffer;
  }, [bytes]);
  useResource((dispose) => {
    dispose(() => source.destroy());
  }, [source]);
  const owner = useMemo(() => ({}), []);
  return kind === "status"
    ? <Status source={source} bytes={bytes} />
    : (
      <ThrottledReadback
        token={{
          owner,
          buffer: source,
          bytes,
          layout: "f32",
          generation: epoch,
        }}
        maxHz={60}
        onPause
        label="readback-probe"
        publish={() => {
          controls.published++;
          return true;
        }}
      />
    );
};
const App = () => {
  const device = useDeviceContext();
  const [visible, setVisible] = useState(true);
  const [epoch, setEpoch] = useState(0);
  Object.assign(controls, {
    visible: setVisible,
    epoch: setEpoch,
    fence: () => device.queue.onSubmittedWorkDone(),
  });
  return visible
    ? kind === "bounds"
      ? (
        <Structure data={data}>
          <Bounds epoch={epoch} />
        </Structure>
      )
      : <Source epoch={epoch} />
    : null;
};
render(
  <WebGPU fallback={null}>
    <AutoCanvas selector="#root" samples={1}>
      <App />
    </AutoCanvas>
  </WebGPU>,
);
