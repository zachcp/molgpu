// CPU tensors: dense, row-major, read-only by contract once constructed.

/** A dense row-major float32 tensor on the CPU. */
export interface Tensor {
  readonly shape: readonly number[];
  readonly data: Float32Array;
}

/** A dense row-major tensor of unsigned 32-bit row indices. */
export interface IndexTensor {
  readonly shape: readonly number[];
  readonly data: Uint32Array;
}

/** Number of elements in a shape; every dimension must be a non-negative integer. */
export function elementCount(shape: readonly number[]): number {
  let count = 1;
  for (const dim of shape) {
    if (!Number.isInteger(dim) || dim < 0) {
      throw new Error(`invalid shape [${shape}]`);
    }
    count *= dim;
  }
  return count;
}

/** A float32 tensor of `shape`, copying `data` (zero-filled when omitted). */
export function tensor(
  shape: readonly number[],
  data?: ArrayLike<number>,
): Tensor {
  const count = elementCount(shape);
  if (data && data.length !== count) {
    throw new Error(
      `tensor: shape [${shape}] needs ${count} values, got ${data.length}`,
    );
  }
  return {
    shape: [...shape],
    data: data ? Float32Array.from(data) : new Float32Array(count),
  };
}

/** An index tensor of `shape`, copying `data`. */
export function indexTensor(
  shape: readonly number[],
  data: ArrayLike<number>,
): IndexTensor {
  const count = elementCount(shape);
  if (data.length !== count) {
    throw new Error(
      `indexTensor: shape [${shape}] needs ${count} values, got ${data.length}`,
    );
  }
  return { shape: [...shape], data: Uint32Array.from(data) };
}

/** Split a shape into [rows, last dimension]; rank must be at least 1. */
export function lastAxis(
  shape: readonly number[],
  op: string,
): [number, number] {
  if (shape.length === 0) throw new Error(`${op}: expected rank >= 1`);
  const n = shape[shape.length - 1];
  return [n === 0 ? 0 : elementCount(shape) / n, n];
}

/** Throw unless `shape` equals `expected`. */
export function expectShape(
  shape: readonly number[],
  expected: readonly number[],
  what: string,
): void {
  if (
    shape.length !== expected.length || shape.some((d, i) => d !== expected[i])
  ) {
    throw new Error(`${what}: expected shape [${expected}], got [${shape}]`);
  }
}
