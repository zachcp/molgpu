// Research-only in-flight status copy across owner unmount.
import { React, render, unmount, useMemo, useResource } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { useDeviceContext } from "@use-gpu/workbench";
import { useStatusReadback } from "../../../packages/viewer/src/internal/status-readback.ts";

void React;
const reports: number[] = [];
const controls = { reports, unmount: () => {} };
Object.assign(globalThis, { __statusProbe: controls });

const StatusProbe = () => {
  const device = useDeviceContext();
  const source = useMemo(() =>
    device.createBuffer({
      size: 16,
      usage: 0x0004 | 0x0008,
      label: "molgpu:status-probe:source",
    }), [device]);
  const read = useStatusReadback(16, "status-probe", (data) => {
    reports.push(new Uint32Array(data)[0]);
  });
  useResource((dispose) => {
    device.queue.writeBuffer(source, 0, Uint32Array.of(42, 0, 0, 0));
    const encoder = device.createCommandEncoder();
    const map = read(encoder, source, 1);
    device.queue.submit([encoder.finish()]);
    map?.();
    dispose(() => source.destroy());
  }, [source]);
  return null;
};

let root: ReturnType<typeof render> | null = render(
  <WebGPU fallback={null}>
    <AutoCanvas selector="#root" samples={1}>
      <StatusProbe />
    </AutoCanvas>
  </WebGPU>,
);
controls.unmount = () => {
  if (root) unmount(root);
  root = null;
};
