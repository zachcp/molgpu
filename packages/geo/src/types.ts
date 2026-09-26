// Pure geometry kernels: typed arrays and plain vec3 arrays in, owned typed
// arrays out. No Mol*, use.gpu, or GPU types.

/** A 3-vector as any indexable of at least three numbers (e.g. `[x, y, z]`). */
export type Vec3Like = ArrayLike<number>;

export interface MarchingCubesInput {
  /** Scalar grid, x-major: `values[x + nx * (y + ny * z)]`. */
  readonly values: Float32Array;
  /** Grid dimensions `[nx, ny, nz]`, each an integer ≥ 2. */
  readonly dims: readonly [number, number, number];
  /** Isovalue; a corner is "inside" when its value is below it. Default 0. */
  readonly level?: number;
  /** World position of grid point (0, 0, 0). Default `[0, 0, 0]`. */
  readonly origin?: readonly [number, number, number];
  /** World distance between grid points on each axis (nonzero). Default `[1, 1, 1]`. */
  readonly spacing?: readonly [number, number, number];
}

export interface MarchingCubesMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** Scratch buffers for one interpolated curve segment of `linearSegments + 1` samples. Mutated in place. */
export interface CurveSegmentState {
  readonly curvePoints: Float32Array;
  readonly tangentVectors: Float32Array;
  readonly normalVectors: Float32Array;
  readonly binormalVectors: Float32Array;
  readonly widthValues: Float32Array;
  readonly heightValues: Float32Array;
  readonly linearSegments: number;
}

/** Five guide points around the segment p1→p2, plus the secondary-structure directions at its ends. */
export interface CurveSegmentControls {
  readonly p0: Vec3Like;
  readonly p1: Vec3Like;
  readonly p2: Vec3Like;
  readonly p3: Vec3Like;
  readonly p4: Vec3Like;
  readonly d12: Vec3Like;
  readonly d23: Vec3Like;
  readonly secStrucFirst: boolean;
  readonly secStrucLast: boolean;
}
