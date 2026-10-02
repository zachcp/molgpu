// Pure geometry kernels: typed arrays and plain vec3 arrays in, owned typed
// arrays out. No Mol*, use.gpu, or GPU types.

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
  /**
   * Column-major 4×4 affine from grid index to world, which may rotate and
   * shear. Replaces `origin`/`spacing` (passing both is an error). Normals map
   * through the inverse transpose; a mirroring affine keeps winding consistent.
   */
  readonly transform?: ArrayLike<number>;
}

export interface MarchingCubesMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/**
 * The lookup tables `marchingCubes` uses, packed as flat typed arrays (for
 * example to upload to a GPU port). Each call returns fresh, owned arrays.
 */
export interface MarchingCubesTables {
  /** Edge mask per cube configuration: 256 entries, bit e set when edge e is cut. */
  readonly edges: Uint16Array;
  /** Edge list per configuration, three per triangle: 256 × 16 slots, padded with 255. */
  readonly triangles: Uint8Array;
  /** Used slots of `triangles` per configuration: 256 entries. */
  readonly triangleLengths: Uint8Array;
  /** Corner offsets of the 12 cube edges: (ai, aj, ak, bi, bj, bk) per edge. */
  readonly cubeEdges: Uint8Array;
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
  readonly p0: ArrayLike<number>;
  readonly p1: ArrayLike<number>;
  readonly p2: ArrayLike<number>;
  readonly p3: ArrayLike<number>;
  readonly p4: ArrayLike<number>;
  readonly d12: ArrayLike<number>;
  readonly d23: ArrayLike<number>;
  readonly secStrucFirst: boolean;
  readonly secStrucLast: boolean;
}
