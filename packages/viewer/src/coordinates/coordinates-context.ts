import { type LiveContext, makeContext, useContext } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { StructureResource } from "../types.ts";

/** The nearest GPU coordinate stream, in structure-local atom order. */
export interface Coordinates {
  readonly source: StorageSource;
  readonly count: number;
  /** Revision local to this provider; compare only within the same source. */
  readonly generation: number;
  /**
   * False until the first dispatch into this output buffer is encoded. Later
   * pending generations retain readiness for drawing; this is not a GPU
   * completion signal. Root CPU uploads may omit it.
   */
  readonly ready?: boolean;
  readonly resource: StructureResource;
}

/** Undefined means no Structure ancestor; null means an empty Structure. */
export const CoordinatesContext: LiveContext<Coordinates | null | undefined> =
  makeContext<Coordinates | null | undefined>(undefined, "CoordinatesContext");

/** Read coordinates supplied by the nearest Structure or coordinate provider. */
export function useCoordinates(): Coordinates | null {
  const coordinates = useContext(CoordinatesContext);
  if (coordinates === undefined) {
    throw new Error("useCoordinates() requires a <Structure> ancestor");
  }
  return coordinates;
}
