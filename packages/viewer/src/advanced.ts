/**
 * Extension APIs for custom molecular representations and GPU providers.
 * Read the nearest structure, coordinates and volumes; use CPU snapshots when
 * a consumer cannot read GPU data. Snapshots can lag live rendering and return
 * null while pending. Shader and context types require use.gpu 0.20.0.
 *
 * @module
 */
export { WorldSpacePointLayer } from "./representations/world-space-points.ts";
export { AttributeProducer } from "./attributes/attribute-producer.ts";
export { useAttributeSnapshot } from "./attributes/attribute-snapshot.ts";
export type { AttributeSnapshot } from "./attributes/attribute-snapshot-context.ts";
export { useField } from "./field-binding/use-field.ts";
export type { StructureBounds, StructureResource } from "./types.ts";
export { createStructureResource } from "./structure/structure-resource.ts";
export { useStructureResource } from "./structure/structure-context.ts";
export { useCoordinateSnapshot } from "./coordinates/coordinate-snapshot.ts";
export type { CoordinateSnapshot } from "./coordinates/coordinate-snapshot.ts";
export { useCoordinateSelection } from "./coordinates/use-coordinate-selection.ts";
export { useCoordinateBounds } from "./coordinates/use-coordinate-bounds.ts";
export type { CoordinateBounds } from "./coordinates/use-coordinate-bounds.ts";
export { useVolumeSnapshot } from "./volume/volume-context.ts";
export { useTimelineTime } from "./timeline-context.ts";
export { CoordinateKernel } from "./coordinates/coordinate-kernel.ts";
export type { CoordinateKernelProps } from "./coordinates/coordinate-kernel.ts";
export { useCoordinates } from "./coordinates/coordinates-context.ts";
export type { Coordinates } from "./coordinates/coordinates-context.ts";
export { useStructure } from "./structure/structure-context.ts";
export type {
  NearestStructure,
  StructureSources,
} from "./structure/structure-context.ts";
export { useVolume } from "./volume/volume-context.ts";
export type { NearestVolume } from "./volume/volume-context.ts";
