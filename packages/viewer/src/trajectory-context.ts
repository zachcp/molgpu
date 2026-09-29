import { type LiveContext, makeContext } from "@use-gpu/live";
import type { StructureResource } from "./types.ts";
import type { TrajectoryFrameState } from "./types.ts";

/** A displayed frame belongs to one structure resource, even when row counts match. */
export interface OwnedTrajectoryFrame {
  readonly owner: StructureResource;
  readonly state: TrajectoryFrameState;
}

/** Structure boundaries shadow this context; Volume and Timeline do not. */
export const TrajectoryContext: LiveContext<OwnedTrajectoryFrame | null> =
  makeContext<OwnedTrajectoryFrame | null>(null, "TrajectoryContext");
