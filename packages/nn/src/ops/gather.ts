// Row gather: out[..., :] = x[index[...], :]. ProteinMPNN's gather_nodes reads
// each residue's K neighbour feature rows this way from an [L, K] index.
import { type IndexTensor, lastAxis, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";

/** Output shape of `gatherRows`: index shape followed by x's row width. */
export function gatherRowsShape(
  x: readonly number[],
  index: readonly number[],
): number[] {
  if (x.length !== 2) {
    throw new Error(`gatherRows: expected x [R, C], got [${x}]`);
  }
  return [...index, x[1]];
}

/** CPU reference; throws on an index outside x's rows. */
export function gatherRows(x: Tensor, index: IndexTensor): Tensor {
  const shape = gatherRowsShape(x.shape, index.shape);
  const [rows, c] = lastAxis(x.shape, "gatherRows");
  const out = new Float32Array(index.data.length * c);
  index.data.forEach((row, i) => {
    if (row >= rows) {
      throw new Error(`gatherRows: index ${row} at ${i} outside ${rows} rows`);
    }
    out.set(x.data.subarray(row * c, row * c + c), i * c);
  });
  return { shape, data: out };
}

/** params: a = index count, b = row width. */
export const GATHER_ROWS_WGSL = /* wgsl */ `${PRELUDE_WGSL}
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> index: array<u32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
${ENTRY_WGSL} {
  let i = thread_index(g, n);
  if (i >= params.a * params.b) { return; }
  let slot = i / params.b;
  y[i] = x[index[slot] * params.b + i % params.b];
}
`;
