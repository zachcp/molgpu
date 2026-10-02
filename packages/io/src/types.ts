// Public types for @molgpu/io.
import type { VolumeData } from "@molgpu/table";
/** Trajectory container formats the readers understand. */
export type TrajectoryFormat = "dcd" | "xtc" | "trr";

/**
 * Random access to the bytes of a file without holding it: a `Uint8Array`, a
 * `Blob`/`File`, or an HTTP resource read with Range requests.
 */
export interface ByteSource {
  readonly size: number;
  /** `length` bytes from `offset`, clipped to `size`. The result may be a view. */
  read(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

/** Options the per-format readers take; `openTrajectory` passes them through. */
export interface TrajectoryReadOptions {
  /** Decode velocities where the format stores them (TRR). Default false. */
  readonly velocities?: boolean;
  /** Cancels opening (the header scan); frame reads take their own signal. */
  readonly signal?: AbortSignal;
}

/** `openTrajectory` options. */
export interface OpenTrajectoryOptions {
  /** Container format; default: the file name's extension. */
  readonly format?: "dcd" | "xtc" | "trr";
  /** Largest whole-file download when a server ignores Range requests, in bytes.
   * Default 256 MiB; must be a finite nonnegative safe integer. */
  readonly maxDownload?: number;
  /** Decode velocities where the format stores them (TRR). Default false. */
  readonly velocities?: boolean;
  /** Fetch implementation used for URL transport (for credentials or testing). */
  readonly fetch?: typeof fetch;
  /** Cancels opening (the header scan); frame reads take their own signal. */
  readonly signal?: AbortSignal;
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

/** Surface sampling options in Ångström, with an allocation sample cap. */
export interface SurfaceFieldOptions {
  /** Solvent probe radius in Angstrom. Default 1.4. */
  probeRadius?: number;
  /** Requested grid spacing in Angstrom. Default 0.5. */
  resolution?: number;
  /** Probe positions sampled per atom. Default 36. */
  probePositions?: number;
  /** Maximum predicted grid samples before allocation. Default 256³; positive safe integer. */
  maxSamples?: number;
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

/** What `structureFromPqr` substituted while building the structure. */
export interface PqrStructureReport {
  readonly atoms: number;
  /** Atoms whose PQR radius was 0 and whose display radius is the element's. */
  readonly radiusFallbacks: number;
}

/** How `applyPqr` matched records to a structure. */
export interface PqrApplyReport {
  /** Structure atoms that received a record's charge. */
  readonly matched: number;
  /** Structure atoms with no record, as `chain:seq:insertion:name`; they get 0. */
  readonly unmatchedAtoms: readonly string[];
  /** Records with no atom and no heavy atom to fold onto, same key format. */
  readonly unmatchedRecords: readonly string[];
  /**
   * Residue copies, per model and altloc conformer, whose assigned sum differs
   * from the PQR residue sum by > 1e-3 e. `altloc` is "" when the residue has
   * no alternate locations.
   */
  readonly residueDelta: readonly {
    readonly residue: string;
    readonly model: number;
    readonly altloc: string;
    readonly pqr: number;
    readonly assigned: number;
  }[];
}
