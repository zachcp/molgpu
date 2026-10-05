import { type LiveContext, makeContext } from "@use-gpu/live";
import type {
  StructureResource,
  TrajectoryFrameState,
  TrajectoryStatus,
} from "./types.ts";

/** A nearest trajectory scope belongs to one structure, including while opening. */
export interface OwnedTrajectoryFrame {
  readonly owner: StructureResource;
  readonly state: TrajectoryFrameState | null;
  /** Nearest source state, including opening/failure before a frame exists. */
  readonly status: TrajectoryStatus | null;
}

/** Structure boundaries shadow this context; Volume and Timeline do not.
 * Read it through useTrajectoryFrame, which checks the owning structure. */
export const TrajectoryContext: LiveContext<OwnedTrajectoryFrame | null> =
  makeContext<OwnedTrajectoryFrame | null>(null, "TrajectoryContext");
