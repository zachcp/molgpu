import {
  React,
  render,
  use,
  useMemo,
  useResource,
  useState,
} from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { OrbitCamera, Pass, useDeviceContext } from "@use-gpu/workbench";
import { Structure } from "@molgpu/viewer";
import { structure } from "../../../fields/test/fixture.ts";
import { ThrottledReadback } from "../../src/internal/throttled-readback.ts";
import type { ReadbackToken } from "../../src/internal/readback-token.ts";

void React;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const probe = {
  events: [] as { owner: string; values: number[] }[],
  replace: (_source: "same-buffer" | "buffer" | "layout" | "resize") => {},
  unmount: () => {},
};
Object.assign(globalThis, { __readbackIdentity: probe });

const Probe = () => {
  const device = useDeviceContext();
  const sources = useMemo(() => {
    const first = device.createBuffer({
      size: 8,
      usage: COPY_SRC | COPY_DST,
    });
    const second = device.createBuffer({
      size: 8,
      usage: COPY_SRC | COPY_DST,
    });
    const resized = device.createBuffer({
      size: 12,
      usage: COPY_SRC | COPY_DST,
    });
    device.queue.writeBuffer(first, 0, Float32Array.of(1, 2));
    device.queue.writeBuffer(second, 0, Float32Array.of(3, 4));
    device.queue.writeBuffer(resized, 0, Float32Array.of(5, 6, 7));
    const firstOwner = {};
    const nextOwner = {};
    const layout = {};
    const tokens: Record<string, ReadbackToken> = {
      first: {
        owner: firstOwner,
        buffer: first,
        bytes: 8,
        layout,
        generation: 1,
      },
      "same-buffer": {
        owner: nextOwner,
        buffer: first,
        bytes: 8,
        layout,
        generation: 1,
      },
      buffer: {
        owner: firstOwner,
        buffer: second,
        bytes: 8,
        layout,
        generation: 1,
      },
      layout: {
        owner: firstOwner,
        buffer: first,
        bytes: 8,
        layout: {},
        generation: 1,
      },
      resize: {
        owner: firstOwner,
        buffer: resized,
        bytes: 12,
        layout: {},
        generation: 1,
      },
    };
    return { buffers: [first, second, resized], tokens };
  }, [device]);
  useResource((dispose) => {
    dispose(() => sources.buffers.forEach((buffer) => buffer.destroy()));
  }, [sources]);
  const [source, setSource] = useState("first");
  const [mounted, setMounted] = useState(true);
  probe.replace = setSource;
  probe.unmount = () => setMounted(false);
  return mounted
    ? use(ThrottledReadback, {
      token: sources.tokens[source],
      maxHz: 1000,
      onPause: true,
      label: "readback-probe",
      publish: (values: Float32Array, token: ReadbackToken) => {
        const owner = Object.entries(sources.tokens).find(([, candidate]) =>
          candidate === token
        )?.[0] ?? "unknown";
        probe.events.push({ owner, values: Array.from(values) });
        return true;
      },
    })
    : null;
};

render(
  <WebGPU fallback={null}>
    <AutoCanvas selector="#root">
      <OrbitCamera radius={10}>
        <Pass>
          <Structure data={structure()}>
            <Probe />
          </Structure>
        </Pass>
      </OrbitCamera>
    </AutoCanvas>
  </WebGPU>,
);
