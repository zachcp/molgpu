import type { ShaderSource } from "@use-gpu/shader";
import { wgsl } from "@use-gpu/shader/wgsl";
import { useShader } from "@use-gpu/workbench";

const UNSPLIT = wgsl`
@link fn getEndpoints(bond: u32) -> vec2<u32>;
@link fn getAtomPosition(atom: u32) -> vec3<f32>;
@export fn getBondPosition(vertex: u32) -> vec3<f32> {
  let pair = getEndpoints(vertex / 2u);
  return getAtomPosition(select(pair.x, pair.y, vertex % 2u == 1u));
}
`;

const SPLIT = wgsl`
@link fn getEndpoints(bond: u32) -> vec2<u32>;
@link fn getAtomPosition(atom: u32) -> vec3<f32>;
@export fn getBondPosition(vertex: u32) -> vec3<f32> {
  let pair = getEndpoints(vertex / 4u);
  let part = vertex % 4u;
  let a = getAtomPosition(pair.x);
  let b = getAtomPosition(pair.y);
  if (part == 0u) { return a; }
  if (part == 3u) { return b; }
  return (a + b) * 0.5;
}
`;

/** Vertex positions follow the nearest GPU coordinate stream. */
export function useBondPositions(
  endpoints: ShaderSource,
  coordinates: ShaderSource,
  split: boolean,
): ShaderSource {
  return useShader(split ? SPLIT : UNSPLIT, [endpoints, coordinates]);
}
