/**
 * Reusable molecular colour, scalar and label fields.
 * Compose constructors, evaluate on CPU with `evaluate`, or generate WGSL and
 * plain binding descriptions with `compile`. No renderer is required.
 *
 * @module
 */
export type {
  Color,
  Domain,
  Field,
  IdentityField,
  ResidueIdentity,
  ValueType,
} from "./types.ts";
export {
  annotation,
  attribute,
  categorical,
  colormap,
  columnRange,
  constant,
  curve,
  linear,
  readsNearestVolume,
  volumeSample,
} from "./construction.ts";
export { COLOR, SCALAR } from "./construction.ts";
export { sampleVolumeGradientWgsl, sampleVolumeWgsl } from "./volume.ts";

// Built-in colour presets composed from the primitives above.
export {
  byBfactor,
  byChain,
  byCharge,
  byElement,
  byPotential,
  bySecondaryStructure,
  bySeq,
} from "./builtins.ts";

// Identity-keyed annotation joins that produce annotation fields.
export { joinAnnotation } from "./annotation-join.ts";

export { compile } from "./compile.ts";
export { evaluate } from "./evaluation.ts";
