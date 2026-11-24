import type { ShaderSource } from "@use-gpu/shader";
import { wgsl } from "@use-gpu/shader/wgsl";
import { useShader } from "@use-gpu/workbench";

// A bond draws 2 vertices [A, B], or 4 when split at its midpoint
// [A, mid, mid, B]. LineLayer `segment: 1` pairs them into strokes, so the
// only uploaded column is the bond's endpoint rows.

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

const UNSPLIT_ROW = wgsl`
@link fn getEndpoints(bond: u32) -> vec2<u32>;
@export fn getBondRow(vertex: u32) -> u32 {
  let pair = getEndpoints(vertex / 2u);
  return select(pair.x, pair.y, vertex % 2u == 1u);
}
`;

// Each half of a split bond takes its own endpoint's row: [A, A, B, B].
const SPLIT_ROW = wgsl`
@link fn getEndpoints(bond: u32) -> vec2<u32>;
@export fn getBondRow(vertex: u32) -> u32 {
  let pair = getEndpoints(vertex / 4u);
  return select(pair.x, pair.y, vertex % 4u >= 2u);
}
`;

/** LineLayer vertices per bond. */
export const bondVertices = (split: boolean): number => split ? 4 : 2;

/** Vertex positions follow the nearest GPU coordinate stream. */
export function useBondPositions(
  endpoints: ShaderSource,
  coordinates: ShaderSource,
  split: boolean,
): ShaderSource {
  return useShader(split ? SPLIT : UNSPLIT, [endpoints, coordinates]);
}

/** Each vertex's atom row, derived from the endpoint column. */
export function useBondRows(
  endpoints: ShaderSource,
  split: boolean,
): ShaderSource {
  return useShader(split ? SPLIT_ROW : UNSPLIT_ROW, [endpoints]);
}
