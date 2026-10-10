import { type LiveContext, makeContext, useContext } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { StructureResource } from "../types.ts";

/** The nearest GPU coordinate stream, in structure-local atom order. */
export interface Coordinates {
  readonly source: StorageSource;
  readonly count: number;
  readonly generation: number;
  /** False until the requested content revision has been submitted. */
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
