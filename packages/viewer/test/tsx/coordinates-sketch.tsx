/**
 * Typed sketch of the Phase 9 coordinate-provider contract
 * (docs/findings/2026-09-26-coordinate-provider-contract.md). It proves the
 * planned composition type-checks against today's public components before any
 * provider exists. The contract types below are declarations only: nothing in
 * @molgpu/viewer exports them yet, and this file is never run or bundled.
 *
 * `deno task typecheck:components` compiles it.
 */
import { React } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { StructureData } from "@molgpu/table";
import type { SelectionQuery } from "@molgpu/select";
import { Ribbon, Spacefill, Structure } from "@molgpu/viewer";
import type { ViewerComponent, ViewerElement } from "@molgpu/viewer";
import type { StructureResource } from "@molgpu/viewer/advanced";

void React;

/** Answer 1: the value CoordinatesContext carries. */
interface Coordinates {
  readonly source: StorageSource;
  readonly count: number;
  readonly generation: number;
  readonly resource: StructureResource;
}

/** Answer 5: a snapshot consumer's view of the nearest coordinates. */
interface CoordinateSnapshot {
  readonly resource: StructureResource;
  readonly generation: number;
}

declare function useCoordinates(): Coordinates;
declare function useCoordinateSnapshot(
  options?: { maxHz?: number },
): CoordinateSnapshot | null;

/** Phase 12 and 13 providers, as planned: child nodes that re-provide coordinates. */
interface TrajectorySketch {
  readonly atomCount: number;
  readonly frameCount: number;
}
declare const Trajectory: ViewerComponent<{
  data: TrajectorySketch;
  frame: number | ((t: number) => number);
  children?: ViewerElement;
}>;
declare const Superpose: ViewerComponent<{
  to: "first" | number;
  select?: SelectionQuery;
  children?: ViewerElement;
}>;

declare const data: StructureData;
declare const trajectory: TrajectorySketch;
declare const ca: SelectionQuery;

export const scene: ViewerElement = (
  <Structure data={data}>
    <Spacefill />
    <Trajectory data={trajectory} frame={(t: number) => t * 30}>
      <Superpose to="first" select={ca}>
        <Spacefill />
        <Ribbon />
      </Superpose>
    </Trajectory>
  </Structure>
);

/** A live consumer binds the source; a snapshot consumer keys on generation. */
export function consumerShapes(): readonly [StorageSource, number | null] {
  const { source } = useCoordinates();
  const snapshot = useCoordinateSnapshot({ maxHz: 4 });
  return [source, snapshot?.resource.positionsRevision ?? null];
}
