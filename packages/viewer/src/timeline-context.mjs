import { makeContext, provide, useContext } from '@use-gpu/live';
import { sample } from '@molgpu/timeline';

/** The caller owns time; rendering never advances it from a wall clock. */
export const TimelineContext = makeContext(null, 'TimelineContext');

export const TimelineProvider = ({ time, children }) => {
  if (typeof time !== 'number' || !Number.isFinite(time))
    throw new TypeError('TimelineProvider time must be finite seconds');
  return provide(TimelineContext, time, children);
};

export const useTimelineTime = () => {
  const time = useContext(TimelineContext);
  if (time === null) throw new Error('useTimelineTime() requires a <TimelineProvider> ancestor');
  return time;
};

/** Sample the same global time used by time-dependent fields. */
export const useTimelineSample = (curve) => sample(curve, useTimelineTime());
