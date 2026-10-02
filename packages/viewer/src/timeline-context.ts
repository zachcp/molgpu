import type { ViewerComponent, ViewerElement } from "./types.ts";
import {
  type LiveContext,
  makeContext,
  provide,
  useContext,
} from "@use-gpu/live";

/** The caller owns time; rendering never advances it from a wall clock. */
export const TimelineContext: LiveContext<number | null> = makeContext<
  number | null
>(null, "TimelineContext");

/** Provide caller-controlled time in seconds to descendant curves and fields. */
export const TimelineProvider: ViewerComponent<
  { time: number; children?: ViewerElement }
> = ({ time, children }) => {
  if (typeof time !== "number" || !Number.isFinite(time)) {
    throw new TypeError("TimelineProvider time must be finite seconds");
  }
  return (provide(TimelineContext, time, children));
};

/** Read time in seconds; requires a TimelineProvider ancestor. */
export function useTimelineTime(): number {
  const time = useContext(TimelineContext);
  if (time === null) {
    throw new Error("useTimelineTime() requires a <TimelineProvider> ancestor");
  }
  return time;
}
