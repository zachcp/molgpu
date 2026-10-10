import { useContext } from "@use-gpu/live";
import { StructureContext } from "../structure-context.ts";
import { TrajectoryContext } from "./trajectory-context.ts";
import type { TrajectoryFrameState } from "../types.ts";

/** What the nearest `<Trajectory>` shows; null outside one. */
export function useTrajectoryFrame(): TrajectoryFrameState | null {
  const frame = useContext(TrajectoryContext);
  const structure = useContext(StructureContext);
  return frame && structure?.resource === frame.owner ? frame.state : null;
}
