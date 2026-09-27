// Pure coordinate mathematics and WGSL source strings; no renderer dependency.
export {
  type AffineMatrix,
  affineSelectedWgsl,
  affineWgsl,
  applyAffine,
  isIdentityAffine,
  validateAffine,
} from "./affine.ts";
export {
  type CellList,
  type CellListOptions,
  createCellList,
} from "./cell-list.ts";
export { cellListWgsl } from "./cell-list-wgsl.ts";
export {
  type CellListBoundsReadback,
  type CellListPlan,
  planCellList,
} from "./cell-list-plan.ts";
export { fitKabsch, type KabschFit } from "./kabsch.ts";
export { SUPERPOSE_FIT_BYTES, superposeWgsl } from "./superpose-wgsl.ts";
export {
  UNWRAP_LINK_BYTES,
  UNWRAP_PARAMS_BYTES,
  unwrapWgsl,
} from "./unwrap-wgsl.ts";
export {
  buildElasticNetwork,
  type ElasticMode,
  type ElasticNetwork,
  type ElasticSolveOptions,
  MAX_ELASTIC_DIM,
  solveElasticModes,
} from "./elastic-network.ts";
export {
  applyNormalMode,
  type NormalModeData,
  normalModeFromElastic,
  normalModeWgsl,
  residueGuideMap,
  validateNormalMode,
} from "./normal-mode.ts";
export {
  createUnwrapForest,
  minimumImage,
  PbcSearchLimitError,
  type PeriodicBox,
  periodicBox,
  type UnwrapForest,
  unwrapFrame,
  type UnwrapResult,
} from "./pbc.ts";
export {
  type ChargeAssignment,
  type ChargeUnmatched,
  residueNetCharge,
  type TemplateChargeOptions,
  type TemplateChargeReport,
  templateCharges,
} from "./template-charges.ts";
export {
  gasteigerCharges,
  type GasteigerOptions,
  type GasteigerRefusal,
  type GasteigerRefusalReason,
  type GasteigerReport,
} from "./gasteiger.ts";
