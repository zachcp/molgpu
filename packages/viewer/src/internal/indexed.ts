import type { ShaderSource } from "@use-gpu/shader";
import { getShader } from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";

// Read a shared per-atom column through a u32 row column, so a drawn instance
// k samples atom row index[k]. A selection or bond draw uploads only its rows;
// the per-atom columns stay shared and coordinate edits never regather them.
const INDEXED = {
  f32: wgsl`
@link fn getIndex(i: u32) -> u32;
@link fn getData(i: u32) -> f32;
@export fn getIndexedData(i: u32) -> f32 { return getData(getIndex(i)); }
`,
  "vec3<f32>": wgsl`
@link fn getIndex(i: u32) -> u32;
@link fn getData(i: u32) -> vec3<f32>;
@export fn getIndexedData(i: u32) -> vec3<f32> { return getData(getIndex(i)); }
`,
};

/** `source` read at `index` rows; `source` itself when there is no index. */
export function indexed(
  source: ShaderSource,
  index: ShaderSource | null,
  format: keyof typeof INDEXED,
): ShaderSource {
  return index ? getShader(INDEXED[format], [index, source]) : source;
}
