// Research fixture, deliberately inspecting internal publication contracts.
import { React, render, useContext, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { OrbitCamera, Pass, useDeviceContext } from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { Structure } from "@molgpu/viewer";
import {
  AttributeProducer,
  useAttributeSnapshot,
  useCoordinateBounds,
  useCoordinates,
  useCoordinateSnapshot,
} from "@molgpu/viewer/advanced";
import { AttributesContext } from "../../../packages/viewer/src/attributes/attributes-context.ts";
import { OffsetCoordinates } from "../../../packages/viewer/test/tsx/offset-coordinates.ts";
import { structure } from "../../../packages/fields/test/fixture.ts";

void React;
const COPY_DST = 0x0008;
const MAP_READ = 0x0001;

const probe = {
  coordinates: null as null | ReturnType<typeof useCoordinates>,
  snapshot: null as null | number[],
  positions: null as null | number[],
  read: () => Promise.resolve([] as number[]),
  bounds: null as null | number[],
  attributeReady: false,
  attributeBuffer: null as GPUBuffer | null,
  setOffset: (_value: number) => {},
  setMounted: (_value: boolean) => {},
};
Object.assign(globalThis, { __readiness: probe });

const KERNEL = wgsl`
@link fn getSize() -> vec2<u32>;
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= getSize().x) { return; }
  output[id.x] = getInput(id.x).x + 113.0;
}
`;

const Probe = () => {
  const device = useDeviceContext();
  probe.coordinates = useCoordinates();
  const entry = useContext(AttributesContext)?.["spike:x"];
  const snapshot = useAttributeSnapshot("spike:x", { maxHz: 10 });
  const coordinates = useCoordinateSnapshot({ maxHz: 10 });
  const bounds = useCoordinateBounds();
  probe.bounds = bounds ? [...bounds.min, ...bounds.max] : null;
  probe.attributeReady = entry?.ready ?? false;
  probe.attributeBuffer = entry?.source.buffer ?? null;
  probe.snapshot = snapshot
    ? Array.from(snapshot.data.attributes!["spike:x"].values)
    : null;
  probe.positions = coordinates ? Array.from(coordinates.data.positions) : null;
  probe.read = async () => {
    if (!entry) throw new Error("missing attribute");
    const size = entry.source.length * 4;
    const staging = device.createBuffer({
      size,
      usage: COPY_DST | MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(entry.source.buffer, 0, staging, 0, size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(MAP_READ);
      const values = Array.from(
        new Float32Array(staging.getMappedRange().slice(0)),
      );
      staging.unmap();
      return values;
    } finally {
      staging.destroy();
    }
  };
  return null;
};

const Controlled = () => {
  const [offset, setOffset] = useState(7);
  const [mounted, setMounted] = useState(true);
  probe.setOffset = setOffset;
  probe.setMounted = setMounted;
  return mounted
    ? (
      <OffsetCoordinates offset={[offset, 0, 0]}>
        <AttributeProducer
          name="spike:x"
          domain="atom"
          kind="scalar"
          kernel={KERNEL}
        >
          <Probe />
        </AttributeProducer>
      </OffsetCoordinates>
    )
    : null;
};

render(
  <WebGPU fallback={null}>
    <AutoCanvas selector="#root">
      <OrbitCamera radius={30}>
        <Pass>
          <Structure data={structure()}>
            <Controlled />
          </Structure>
        </Pass>
      </OrbitCamera>
    </AutoCanvas>
  </WebGPU>,
);
