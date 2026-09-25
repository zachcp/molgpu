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

/** Extract an indexed isosurface mesh from a scalar grid. Throws TypeError/RangeError on malformed input. */
export function marchingCubes(input: MarchingCubesInput): MarchingCubesMesh;

/**
 * For each vertex in `positions` (packed vec3s), the index of the exactly
 * nearest atom in `atomPositions` (packed vec3s). `cellSize` is a performance
 * hint only (roughly the largest expected vertex-to-atom distance).
 */
export function nearestAtomAttribution(positions: Float32Array, atomPositions: Float32Array, cellSize: number): Uint32Array;

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

export function createCurveSegmentState(linearSegments: number): CurveSegmentState;
/** Fill points, tangents, normals and binormals (interpolatePointsAndTangents then interpolateNormals). */
export function interpolateCurveSegment(state: CurveSegmentState, controls: CurveSegmentControls, tension: number, shift: number): void;
export function interpolatePointsAndTangents(state: CurveSegmentState, controls: CurveSegmentControls, tension: number, shift: number): void;
export function interpolateNormals(state: CurveSegmentState, controls: Pick<CurveSegmentControls, 'd12' | 'd23'>): void;
/** Fill `widthValues`/`heightValues` by interpolating w0→w1→w2 and h0→h1→h2 across the segment. */
export function interpolateSizes(state: CurveSegmentState, w0: number, w1: number, w2: number, h0: number, h1: number, h2: number, shift: number): void;
