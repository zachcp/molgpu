import { type LiveContext, makeContext, useContext } from "@use-gpu/live";
import { StructureContext } from "./structure-context.ts";
import type { StructureResource } from "./types.ts";
import type { TrajectoryFrameState, TrajectoryStatus } from "./types.ts";

/** A nearest trajectory scope belongs to one structure, including while opening. */
export interface OwnedTrajectoryFrame {
  readonly owner: StructureResource;
  readonly state: TrajectoryFrameState | null;
  /** Nearest source state, including opening/failure before a frame exists. */
  readonly status: TrajectoryStatus | null;
}

/** Structure boundaries shadow this context; Volume and Timeline do not. */
export const TrajectoryContext: LiveContext<OwnedTrajectoryFrame | null> =
  makeContext<OwnedTrajectoryFrame | null>(null, "TrajectoryContext");

/** What the nearest `<Trajectory>` shows; null outside one. */
export function useTrajectoryFrame(): TrajectoryFrameState | null {
  const frame = useContext(TrajectoryContext);
  const structure = useContext(StructureContext);
  return frame && structure?.resource === frame.owner ? frame.state : null;
}
