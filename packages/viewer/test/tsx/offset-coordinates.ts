import { type LC, type LiveElement, use } from "@use-gpu/live";
import { wgsl } from "@use-gpu/shader/wgsl";
import { useCoordinates } from "../../src/coordinates/coordinates-context.ts";
import { CoordinateKernel } from "../../src/coordinates/coordinate-kernel.ts";

const OFFSET = wgsl`
@link fn getSize() -> vec2<u32>;
@link fn getOffset() -> vec3<f32>;
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  let p = getInput(i) + getOffset();
  output[i * 3u] = p.x;
  output[i * 3u + 1u] = p.y;
  output[i * 3u + 2u] = p.z;
}
`;

/** Deterministic GPU fixture for coordinate-provider chaining. */
export const OffsetCoordinates: LC<{
  offset: readonly [number, number, number];
  children?: LiveElement;
}> = ({ offset, children }) => {
  const upstream = useCoordinates();
  if (!upstream) return children ?? null;
  const [x, y, z] = offset;
  return use(CoordinateKernel, {
    upstream,
    shader: OFFSET,
    args: [[x, y, z]],
    parameterKey: `${x},${y},${z}`,
    children: children ?? null,
  });
};
