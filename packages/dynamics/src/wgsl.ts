/**
 * Advanced shader sources, buffer layouts and dispatch helpers for molecular
 * computation. The caller compiles shaders, owns GPU resources and orders
 * dispatches. Individual exports document their binding and uniform contracts.
 *
 * @module
 */
// @molgpu/dynamics/wgsl: WGSL sources, buffer layouts and dispatch planning
// for the GPU paths in @molgpu/viewer. Strings and plain data only; this
// package still never imports @use-gpu/*.
export {
  type AffineMatrix,
  affineSelectedWgsl,
  affineWgsl,
  isIdentityAffine,
  validateAffine,
} from "./affine.ts";
export { cellListWgsl } from "./cell-list-wgsl.ts";
export {
  type CellListBoundsReadback,
  type CellListPlan,
  planCellList,
} from "./cell-list-plan.ts";
export {
  type DsspBridge,
  type DsspLayout,
  finishDssp,
  prepareDsspLayout,
} from "./dssp-layout.ts";
export { dsspWgsl } from "./dssp-wgsl.ts";
export { SUPERPOSE_FIT_BYTES, superposeWgsl } from "./superpose-wgsl.ts";
export {
  UNWRAP_LINK_BYTES,
  UNWRAP_PARAMS_BYTES,
  unwrapWgsl,
} from "./unwrap-wgsl.ts";
export { createUnwrapForest, type UnwrapForest } from "./pbc.ts";
export { normalModeWgsl, validateNormalMode } from "./normal-mode.ts";
export {
  COULOMB_CUTOFF_BRICK,
  COULOMB_GRID_BLOCK,
  COULOMB_MODEL_CODE,
  COULOMB_PARAMS_BYTES,
  COULOMB_WORKGROUP,
  type CoulombDispatch,
  coulombParams,
  coulombWgsl,
} from "./electrostatics-wgsl.ts";
export {
  elasticDisplacementWgsl,
  LANGEVIN_PARAMS_BYTES,
  type LangevinBuffers,
  langevinBuffers,
  langevinUniform,
  langevinWgsl,
} from "./langevin-wgsl.ts";
