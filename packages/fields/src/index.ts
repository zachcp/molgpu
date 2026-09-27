// @molgpu/fields — typed per-row value descriptions with one pure CPU evaluator
// and a renderer-free WGSL code generator.
//
// A Field<T, Domain> assigns a value of type T to every row of a domain (atom or
// residue). Selections say WHICH rows; fields say WHAT VALUE each row gets — a
// colour, a radius, an opacity, a category. One concept replaces MolViewSpec's
// color / color_from_source x categorical / continuous x domain / overflow
// matrix.
//
// The package is renderer-free: it never imports use.gpu and never returns a
// ShaderSource. `evaluate` computes values on the CPU (for tests, labels, and
// annotation joins); `compile` emits a WGSL string plus a plain-data binding
// schema that the viewer lowers to GPU sources. Numeric/vector fields lower;
// string fields are CPU-only. There is no arbitrary JS->WGSL and no user parser.

export type {
  Binding,
  Color,
  Compiled,
  Domain,
  EvalContext,
  Field,
  IdentityField,
  JoinOptions,
  Overflow,
  ResidueIdentity,
  Scalar,
  Target,
  ValueType,
} from "./types.ts";
export {
  annotation,
  attribute,
  categorical,
  colormap,
  compile,
  constant,
  curve,
  evaluate,
  linear,
  readsNearestVolume,
  volumeSample,
} from "./primitives.ts";
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
