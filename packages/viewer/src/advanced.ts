// @molgpu/viewer/advanced: the use.gpu-shaped escape hatches. Everything here
// exposes use.gpu shader sources, Live contexts or shader modules in its
// signature, so it is kept out of the "." entry (see README "API").
export { WorldSpacePointLayer } from "./world-space-points.ts";
export { StructureContext, useStructure } from "./structure-context.ts";
export type {
  StructureContextValue,
  StructureSources,
} from "./structure-context.ts";
export { TimelineContext } from "./timeline-context.ts";
export { FlatMaterial, LitMaterial } from "./materials.ts";
export { useField } from "./use-field.ts";
