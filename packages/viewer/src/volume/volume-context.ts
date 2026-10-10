import {
  type LiveContext,
  makeContext,
  useContext,
  useRef,
  useResource,
} from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { VolumeData, VolumeGrid } from "@molgpu/table";

/**
 * The nearest volume: a `<Volume>` (samples on the CPU and GPU) or a computed
 * volume such as `<EField>` (samples on the GPU, CPU copies on demand).
 */
export interface NearestVolume {
  /** Dims, index-to-world transform, components and unit. Stable while the grid is. */
  readonly grid: VolumeGrid;
  /** Scalar samples, x-fastest, as a live f32 storage source. */
  readonly source: StorageSource;
  /** Revision local to this volume provider; 1 for a loaded volume. */
  readonly generation: number;
  /** Default display interval (a slice's colour range). */
  readonly range: readonly [number, number];
  /** The CPU samples, when they exist without a readback: `<Volume>` only. */
  readonly volume: VolumeData | null;
  /** Latest published CPU snapshot (the volume itself for `<Volume>`). */
  readonly snapshot: VolumeData | null;
  /** Subscribe to shared readback demand at `maxHz`; returns the release. */
  readonly subscribe: (maxHz: number, onPause: boolean) => () => void;
}

/** Null outside any volume, so optional readers (field lowering) can ask. */
export const VolumeContext: LiveContext<NearestVolume | null> = makeContext<
  NearestVolume | null
>(null, "VolumeContext");

/** Read the nearest volume; throws without one. */
export function useVolume(): NearestVolume {
  const value = useContext(VolumeContext);
  if (!value) {
    throw new Error("useVolume() requires a <Volume> or <EField> ancestor");
  }
  return value;
}

/**
 * The nearest volume's samples on the CPU, for consumers that cannot read the
 * GPU copy (marching cubes, statistics). A loaded `<Volume>` returns its data
 * at once. A computed volume returns null until its first matching readback;
 * later snapshots can lag live samples. `maxHz` requests a positive rate
 * (default 4); subscribers share the highest requested rate. The last eligible
 * revision stays scheduled after changes stop, within that rate interval.
 * `onPause` is retained for compatibility and currently does not change this
 * scheduling. Consumers remesh per published `VolumeData`; a source-local
 * generation is not exposed on the snapshot.
 */
export function useVolumeSnapshot(
  options: { maxHz?: number; onPause?: boolean } = {},
): VolumeData | null {
  const context = useVolume();
  const maxHz = options.maxHz ?? 4;
  const onPause = options.onPause ?? true;
  if (!Number.isFinite(maxHz) || maxHz <= 0) {
    throw new TypeError("useVolumeSnapshot maxHz must be positive and finite");
  }
  useResource((dispose) => {
    dispose(context.subscribe(maxHz, onPause));
  }, [context.subscribe, maxHz, onPause]);
  return context.snapshot;
}

const sameGrid = (a: VolumeGrid, b: VolumeGrid): boolean =>
  a.components === b.components && a.unit === b.unit &&
  a.dims.every((n, i) => n === b.dims[i]) &&
  a.transform.every((v, i) => v === b.transform[i]);

/**
 * `grid` as a samples-free object that keeps its identity while the grid's
 * value (dims, transform, components, unit) is unchanged, so a new
 * `VolumeData` on the same grid, or a recomputed one, recompiles no sampler.
 */
export function useStableGrid(grid: VolumeGrid): VolumeGrid {
  const ref = useRef<VolumeGrid | null>(null);
  const previous = ref.current;
  if (previous && sameGrid(previous, grid)) return previous;
  const next: VolumeGrid = Object.freeze({
    dims: grid.dims,
    transform: grid.transform,
    components: grid.components,
    ...(grid.unit === undefined ? {} : { unit: grid.unit }),
  });
  ref.current = next;
  return next;
}
