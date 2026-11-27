/**
 * Neural-network building blocks for molecular models: CPU reference ops and a
 * raw-WebGPU runtime whose weight and activation buffers can be shared with a
 * renderer on the same device.
 *
 * @module
 */
export {
  elementCount,
  type IndexTensor,
  indexTensor,
  type Tensor,
  tensor,
} from "./tensor.ts";
export { erf, gelu } from "./ops/gelu.ts";
export { type Activation, linear } from "./ops/linear.ts";
export { LAYER_NORM_EPS, layerNorm } from "./ops/layer-norm.ts";
export { concat } from "./ops/concat.ts";
export { gatherRows } from "./ops/gather.ts";
export { mix } from "./ops/mix.ts";
export { neighborSum } from "./ops/neighbor-sum.ts";
export { logSoftmax } from "./ops/log-softmax.ts";
export { parseSafetensors } from "./safetensors.ts";
export { type GpuTensor, NnRuntime } from "./runtime.ts";
export {
  type BackboneSource,
  PROTEIN_MPNN_ALPHABET,
  type ProteinMpnnInput,
  proteinMpnnInput,
} from "./models/protein-mpnn/input.ts";
export {
  PROTEIN_MPNN_ATOM_PAIRS,
  PROTEIN_MPNN_NEIGHBORS,
  type ProteinMpnnGraph,
  proteinMpnnGraph,
} from "./models/protein-mpnn/features.ts";
export {
  ProteinMpnn,
  type ProteinMpnnEncoding,
  type ProteinMpnnRunOptions,
  type ProteinMpnnVisibility,
} from "./models/protein-mpnn/model.ts";
export {
  type ProteinMpnnStage,
  type ProteinMpnnStep,
  ProteinMpnnTrace,
} from "./models/protein-mpnn/trace.ts";
