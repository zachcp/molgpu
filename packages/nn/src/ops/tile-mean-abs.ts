// Snapshot reduction for large weight matrices: one mean |w| per 32 x 32 tile.
import { elementCount, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";

/** Validate a non-empty matrix and return its 32 x 32 tile grid shape. */
export function tileMeanAbsShape(shape: readonly number[]): number[] {
  if (shape.length !== 2 || elementCount(shape) === 0) {
    throw new Error("tileMeanAbs: expected a non-empty [rows, columns] matrix");
  }
  return shape.map((n) => Math.ceil(n / 32));
}

/** Mean absolute value per 32 x 32 tile; partial edge tiles use their actual count. */
export function tileMeanAbs(x: Tensor): Tensor {
  const shape = tileMeanAbsShape(x.shape);
  const [rows, cols] = x.shape;
  const data = new Float32Array(elementCount(shape));
  for (let tr = 0; tr < shape[0]; tr++) {
    for (let tc = 0; tc < shape[1]; tc++) {
      const endRow = Math.min(rows, (tr + 1) * 32);
      const endCol = Math.min(cols, (tc + 1) * 32);
      let sum = 0;
      for (let r = tr * 32; r < endRow; r++) {
        for (let c = tc * 32; c < endCol; c++) {
          sum += Math.abs(x.data[r * cols + c]);
        }
      }
      data[tr * shape[1] + tc] = sum /
        ((endRow - tr * 32) * (endCol - tc * 32));
    }
  }
  return { shape, data };
}

// One dispatch per tile row. Only that row's input band is bound, so the source
// buffer may exceed maxStorageBufferBindingSize. d skips alignment padding.
// params: a = rows, b = columns, c = first row, d = input offset in f32s,
// e = tile columns. Output is the full compact grid, in checkpoint axis order.
export const TILE_MEAN_ABS_WGSL = /* wgsl */ `${PRELUDE_WGSL}
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
${ENTRY_WGSL} {
  let tile = thread_index(g, n);
  if (tile >= params.e) { return; }
  let height = min(32u, params.a - params.c);
  let width = min(32u, params.b - tile * 32u);
  // Normalize before summing: a finite tile mean must not overflow just
  // because its unscaled sum exceeds f32. Starting at 1 also handles zeros.
  var scale = 1.0;
  for (var r = 0u; r < height; r++) {
    for (var c = 0u; c < width; c++) {
      scale = max(scale, abs(x[params.d + r * params.b + tile * 32u + c]));
    }
  }
  var sum = 0.0;
  for (var r = 0u; r < height; r++) {
    for (var c = 0u; c < width; c++) {
      sum += abs(x[params.d + r * params.b + tile * 32u + c]) / scale;
    }
  }
  y[(params.c / 32u) * params.e + tile] = (sum / f32(height * width)) * scale;
}
`;
