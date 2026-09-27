// @molgpu/viewer/advanced: escape hatches for custom representations and
// providers. Some exports name use.gpu types (shader sources, Live contexts),
// which "." never does; the rest are CPU snapshot and resource-level hooks that
// an application composing components does not need (see README "API").
export { WorldSpacePointLayer } from "./world-space-points.ts";
export { StructureContext, useStructure } from "./structure-context.ts";
export { CoordinatesContext, useCoordinates } from "./coordinates-context.ts";
export { AttributeProducer } from "./attribute-producer.ts";
export { gpuDssp } from "./gpu-dssp.ts";
export type { GpuDsspOptions, GpuDsspResult } from "./gpu-dssp.ts";
export { AttributesContext } from "./attributes-context.ts";
export type { Attributes, ProducedAttribute } from "./attributes-context.ts";
export { useAttributeSnapshot } from "./attribute-snapshot.ts";
export type { AttributeSnapshot } from "./attribute-snapshot.ts";
export type { Coordinates } from "./coordinates-context.ts";
export { IdentityCoordinates } from "./identity-coordinates.ts";
export { WobbleCoordinates } from "./wobble-coordinates.ts";
export type {
  StructureContextValue,
  StructureSources,
} from "./structure-context.ts";
export { TimelineContext } from "./timeline-context.ts";
export { TrajectoryContext } from "./trajectory.ts";
export { useVolume, VolumeContext } from "./volume-context.ts";
export type { VolumeContextValue } from "./volume-context.ts";
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
