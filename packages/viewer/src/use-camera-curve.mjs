import { useTimelineTime } from './timeline-context.mjs';
import { sampleCamera } from './camera-curve.mjs';

/** Live binding for OrbitCamera props under a controlled TimelineProvider. */
export const useCameraCurve = (curve, resource, focusOptions) =>
  sampleCamera(curve, useTimelineTime(), resource, focusOptions);
