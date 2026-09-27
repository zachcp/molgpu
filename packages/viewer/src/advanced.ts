// @molgpu/viewer/advanced: the use.gpu-shaped escape hatches. Everything here
// exposes use.gpu shader sources, Live contexts or shader modules in its
// signature, so it is kept out of the "." entry (see README "API").
export { WorldSpacePointLayer } from "./world-space-points.ts";
export { StructureContext, useStructure } from "./structure-context.ts";
export { CoordinatesContext, useCoordinates } from "./coordinates-context.ts";
export { AttributeProducer } from "./attribute-producer.ts";
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
export { FlatMaterial, LitMaterial } from "./materials.ts";
export { useField } from "./use-field.ts";
