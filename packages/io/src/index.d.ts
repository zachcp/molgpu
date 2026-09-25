import type { StructureData } from '@molgpu/table';

/** Why a BinaryCIF import failed, stable enough to branch on. */
export type BcifErrorCode =
  /** `bytes` was not a `Uint8Array`. */
  | 'INVALID_INPUT'
  /** The Mol* parser rejected the bytes. */
  | 'INVALID_BCIF'
  /** The first data block has no `atom_site` category. */
  | 'MISSING_ATOM_SITE'
  /** The optional Mol* parser is absent or failed to load. */
  | 'PARSER_UNAVAILABLE';

export class BcifParseError extends Error {
  constructor(message: string, code: BcifErrorCode, cause?: unknown);
  readonly name: 'BcifParseError';
  readonly code: BcifErrorCode;
}

/**
 * Lower a BinaryCIF mmCIF block to renderer-independent owned table columns.
 * Mol* is imported lazily inside this call, so consumers that never pass BCIF
 * bytes never load the parser. Rejects with {@link BcifParseError}.
 */
export function structureFromBcif(bytes: Uint8Array): Promise<StructureData>;

/** Why a molecular surface field computation failed, stable enough to branch on. */
export type SurfaceFieldErrorCode =
  /** `count` is not a nonnegative safe integer, or a column is not a `Float32Array` of length `count`. */
  | 'INVALID_INPUT'
  /** `count` is 0. */
  | 'EMPTY_INPUT'
  /** The optional Mol* surface code is absent, failed to load, or threw while computing. */
  | 'FIELD_UNAVAILABLE';

export class SurfaceFieldError extends Error {
  constructor(message: string, code: SurfaceFieldErrorCode, cause?: unknown);
  readonly name: 'SurfaceFieldError';
  readonly code: SurfaceFieldErrorCode;
}

/** Plain owned atom columns: Angstrom coordinates and van der Waals radii. */
export interface SurfaceFieldAtoms {
  readonly count: number;
  /** Length `count`. */
  readonly x: Float32Array;
  /** Length `count`. */
  readonly y: Float32Array;
  /** Length `count`. */
  readonly z: Float32Array;
  /** Van der Waals radius per atom, without the probe; length `count`. */
  readonly radius: Float32Array;
}

export interface SurfaceFieldOptions {
  /** Solvent probe radius in Angstrom. Default 1.4. */
  probeRadius?: number;
  /** Requested grid spacing in Angstrom. Default 0.5. */
  resolution?: number;
  /** Probe positions sampled per atom. Default 36. */
  probePositions?: number;
}

/** A solvent-excluded-surface scalar grid. Every array is freshly owned by the caller. */
export interface SurfaceField {
  /**
   * Grid samples, length `dims[0] * dims[1] * dims[2]`, laid out **z-fastest**
   * (Mol*'s layout): the sample at grid `(i, j, k)` is
   * `values[k + dims[2] * (j + dims[1] * i)]`. Unvisited cells far from every
   * atom hold the sentinel -1001.
   */
  values: Float32Array;
  /** Grid size along x, y, z. */
  dims: [number, number, number];
  /**
   * Column-major 4x4 scale + translate from grid index to Angstrom: spacing is
   * the diagonal (`[0]`, `[5]`, `[10]`), origin is `[12]`, `[13]`, `[14]`.
   */
  transform: Float32Array;
  /** Grid spacing in Angstrom; equals the requested `resolution`. */
  resolution: number;
  /** Largest input van der Waals radius. */
  maxRadius: number;
  /** Isovalue of the surface; always equals `probeRadius`. */
  level: number;
}

/**
 * Solvent-excluded-surface scalar field over plain atom columns, computed by
 * Mol*'s `calcMolecularSurface`. Mol* is imported lazily inside this call.
 * Rejects with {@link SurfaceFieldError}; input is validated before Mol* loads.
 */
export function molecularSurfaceField(atoms: SurfaceFieldAtoms, options?: SurfaceFieldOptions): Promise<SurfaceField>;
