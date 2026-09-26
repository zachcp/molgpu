// @ts-self-types="./advanced.d.ts"
// @molgpu/viewer/advanced: the use.gpu-shaped escape hatches. Everything here
// exposes use.gpu shader sources, Live contexts or shader modules in its
// signature, so it is kept out of the "." entry (see README "API").
export { WorldSpacePointLayer } from './world-space-points.mjs';
export { StructureContext, useStructure } from './structure-context.mjs';
export { TimelineContext } from './timeline-context.mjs';
export { FlatMaterial, LitMaterial } from './materials.mjs';
export { useField } from './use-field.mjs';
