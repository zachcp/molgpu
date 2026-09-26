import { useTimelineTime } from "./timeline-context.ts";
import { sampleCamera } from "./camera-curve.ts";
import type {
  CameraCurve,
  CameraPose,
  FocusOptions,
  StructureResource,
} from "./types.ts";

/** Live binding for OrbitCamera props under a controlled TimelineProvider. */
export function useCameraCurve(
  curve: CameraCurve,
  resource: StructureResource,
  options?: FocusOptions,
): CameraPose {
  return sampleCamera(curve, useTimelineTime(), resource, options);
}
