/**
 * Extension APIs for custom molecular representations and GPU providers.
 * Read the nearest structure, coordinates and volumes; use CPU snapshots when
 * a consumer cannot read GPU data. Snapshots can lag live rendering and return
 * null while pending. Shader and context types require use.gpu 0.20.0.
 *
 * @module
 */
export { WorldSpacePointLayer } from "./world-space-points.ts";
export { AttributeProducer } from "./attribute-producer.ts";
export { useAttributeSnapshot } from "./attribute-snapshot.ts";
export type { AttributeSnapshot } from "./attribute-snapshot-context.ts";
export { useField } from "./use-field.ts";
export type { StructureBounds, StructureResource } from "./types.ts";
export { createStructureResource } from "./internal/structure-resource.ts";
export { useStructureResource } from "./structure-context.ts";
export { useCoordinateSnapshot } from "./coordinate-snapshot.ts";
export type { CoordinateSnapshot } from "./coordinate-snapshot.ts";
export { useCoordinateSelection } from "./use-coordinate-selection.ts";
export { useCoordinateBounds } from "./use-coordinate-bounds.ts";
export type { CoordinateBounds } from "./use-coordinate-bounds.ts";
export { useVolumeSnapshot } from "./volume-context.ts";
export { useTimelineTime } from "./timeline-context.ts";
export { CoordinateKernel } from "./internal/coordinate-kernel.ts";
export type { CoordinateKernelProps } from "./internal/coordinate-kernel.ts";
export { useCoordinates } from "./coordinates-context.ts";
export type { Coordinates } from "./coordinates-context.ts";
export { useStructure } from "./structure-context.ts";
export type {
  NearestStructure,
  StructureSources,
} from "./structure-context.ts";
export { useVolume } from "./volume-context.ts";
export type { NearestVolume } from "./volume-context.ts";
