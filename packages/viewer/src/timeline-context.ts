import type { ViewerComponent, ViewerElement } from "./types.ts";
import {
  type LiveContext,
  makeContext,
  provide,
  useContext,
} from "@use-gpu/live";
import { live, viewer } from "./internal/elements.ts";

/** The caller owns time; rendering never advances it from a wall clock. */
export const TimelineContext: LiveContext<number | null> = makeContext<
  number | null
>(null, "TimelineContext");

export const TimelineProvider: ViewerComponent<
  { time: number; children?: ViewerElement }
> = ({ time, children }) => {
  if (typeof time !== "number" || !Number.isFinite(time)) {
    throw new TypeError("TimelineProvider time must be finite seconds");
  }
  return viewer(provide(TimelineContext, time, live(children)));
};

export function useTimelineTime(): number {
  const time = useContext(TimelineContext);
  if (time === null) {
    throw new Error("useTimelineTime() requires a <TimelineProvider> ancestor");
  }
  return time;
}

/** Sample the same global time used by time-dependent fields. */
