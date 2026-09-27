/** Copy a Mol* three-dimensional tensor into the x-fastest layout used by io. */
export function gridToXFast<T>(
  space: {
    readonly dimensions: ArrayLike<number>;
    get(data: T, i: number, j: number, k: number): number;
  },
  data: T,
): { dims: [number, number, number]; values: Float32Array } {
  const [nx, ny, nz] = space.dimensions as readonly [number, number, number];
  const values = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        values[i + nx * (j + ny * k)] = space.get(data, i, j, k);
      }
    }
  }
  return { dims: [nx, ny, nz], values };
}
