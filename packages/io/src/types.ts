// Public types for @molgpu/io.
import type { VolumeData } from "@molgpu/table";
/** Why a BinaryCIF import failed, stable enough to branch on. */
export type BcifErrorCode =
  /** `bytes` was not a `Uint8Array`. */
  | "INVALID_INPUT"
  /** The Mol* parser rejected the bytes. */
  | "INVALID_BCIF"
  /** The first data block has no `atom_site` category. */
  | "MISSING_ATOM_SITE"
  /** The optional Mol* parser is absent or failed to load. */
  | "PARSER_UNAVAILABLE";

/** Why a molecular surface field computation failed, stable enough to branch on. */
export type SurfaceFieldErrorCode =
  /** `count` is not a nonnegative safe integer, or a column is not a `Float32Array` of length `count`. */
  | "INVALID_INPUT"
  /** `count` is 0. */
  | "EMPTY_INPUT"
  /** The optional Mol* surface code is absent, failed to load, or threw while computing. */
  | "FIELD_UNAVAILABLE";

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

/**
 * A solvent-excluded-surface scalar grid: a `VolumeData` plus surface metadata.
 * Every array is freshly owned by the caller.
 */
export interface SurfaceField extends VolumeData {
  /**
   * Grid samples, length `dims[0] * dims[1] * dims[2]`, laid out **x-fastest**
   * (the layout `@molgpu/geo`'s `marchingCubes` reads): the sample at grid
   * `(i, j, k)` is `values[i + dims[0] * (j + dims[1] * k)]`. Unvisited cells far from every
   * atom hold the sentinel -1001, which `stats` includes.
   */
  readonly values: Float32Array;
  /**
   * Column-major 4x4 scale + translate from grid index to Angstrom: spacing is
   * the diagonal (`[0]`, `[5]`, `[10]`), origin is `[12]`, `[13]`, `[14]`.
   */
  readonly transform: Float32Array;
  /** Grid spacing in Angstrom; equals the requested `resolution`. */
  readonly resolution: number;
  /** Largest input van der Waals radius. */
  readonly maxRadius: number;
  /** Absolute isovalue of the surface; always equals `probeRadius`. */
  readonly level: number;
}
