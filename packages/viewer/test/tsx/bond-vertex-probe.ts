import {
  type LC,
  type LiveElement,
  use,
  useMemo,
  useResource,
} from "@use-gpu/live";
import type { StorageSource, StorageTarget } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import { Compute, ComputeBuffer, Kernel } from "@use-gpu/workbench";
import type { StructureData } from "@molgpu/table";
import { useCoordinates } from "../../src/coordinates/coordinates-context.ts";
import { buildBondRows } from "../../src/representations/bonds/bond-columns.ts";
import { useBondPositions } from "../../src/representations/bonds/bond-positions.ts";
import { ColumnSource } from "../../src/rendering/column-source.ts";
import { probe } from "./diagnostics.ts";

const COPY_VERTICES = wgsl`
@link fn getSize() -> vec2<u32>;
@link fn getBondPosition(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  let p = getBondPosition(i);
  output[i * 3u] = p.x;
  output[i * 3u + 1u] = p.y;
  output[i * 3u + 2u] = p.z;
}
`;

const Capture: LC<{ source: StorageTarget }> = ({ source }) => {
  probe.bondSource = source;
  useResource((dispose) => {
    dispose(() => {
      if (probe.bondSource?.buffer === source.buffer) probe.bondSource = null;
      source.buffer.destroy();
    });
  }, [source.buffer]);
  return null;
};

const Materialize: LC<{ endpoints: StorageSource; count: number }> = (
  { endpoints, count },
) => {
  const coordinates = useCoordinates();
  if (!coordinates) return null;
  const positions = useBondPositions(
    endpoints,
    coordinates.source,
    true,
  );
  return use(ComputeBuffer, {
    width: count * 3,
    height: 1,
    format: "f32",
    label: "test:bond-vertices",
    children: () =>
      use(Compute, {
        immediate: true,
        children: coordinates.ready === false ? null : use(Kernel, {
          shader: COPY_VERTICES,
          source: positions,
          initial: true,
          version: coordinates.generation,
          size: [count, 1],
        }),
      }),
    then: (source: StorageTarget) => use(Capture, { source }),
  });
};

/** Materialize the exact shader used by Bonds for WebGPU readback. */
export const BondVertexProbe: LC<{ data: StructureData }> = ({ data }) => {
  const rows = useMemo(() => buildBondRows(data, null, "both", true), [data]);
  if (!rows.n) return null;
  return use(ColumnSource, {
    data: rows.endpoints,
    format: "vec2<u32>",
    label: "test:bond-endpoints",
    render: (endpoints: StorageSource | null): LiveElement =>
      endpoints ? use(Materialize, { endpoints, count: rows.n }) : null,
  });
};
