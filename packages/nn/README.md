# @molgpu/nn

Neural-network building blocks for running small molecular models, such as
ProteinMPNN, in the browser on WebGPU. Each op has a CPU reference
implementation and a WGSL kernel kept in one module, so it can be read, tested
and replaced on its own. `NnRuntime` runs the kernels on a `GPUDevice` you
supply. It keeps weights and activations in plain `GPUBuffer`s, so a renderer on
the same device can bind the exact buffer a matrix multiply reads. That makes it
possible to visualize a model's real weights and intermediate activations while
data runs through it.

## Install

```sh
deno add jsr:@molgpu/nn
```

The package has no runtime dependencies: no other `@molgpu` package, no use.gpu
and no ML framework.

## Example

Save as `nn.ts` and run `deno run nn.ts` (Deno ships WebGPU), or bundle it for a
browser.

```ts
import { linear, NnRuntime, tensor } from "@molgpu/nn";

const x = tensor([2, 3], [1, 2, 3, -1, 0, 1]);
const w = tensor([2, 3], [1, 0, 0, 0, 1, 1]); // PyTorch [out, in] layout
const b = tensor([2], [10, 20]);
console.log(linear(x, w, b, "gelu").data); // CPU reference

const adapter = await navigator.gpu.requestAdapter();
const rt = new NnRuntime(await adapter!.requestDevice());
const gw = rt.upload(w, "w");
const y = rt.linear(rt.upload(x), gw, rt.upload(b), "gelu");
console.log(await rt.read(y)); // same values, computed on the GPU
// gw.buffer is the GPUBuffer the kernel read; bind it to draw a heatmap.
rt.destroy();
```

Load real checkpoints with `parseSafetensors` (convert PyTorch `.pt` files with
`safetensors.torch.save_file`), then pass them to `NnRuntime.uploadWeights`.

## ProteinMPNN

`ProteinMpnn` runs the published model (dauparas/ProteinMPNN, MIT) from its
checkpoint converted with `scripts/convert_proteinmpnn.py` to fp16 safetensors.
`encode` builds the neighbour graph on the CPU and runs the three encoder layers
on the GPU, keeping each layer's node embeddings. `decode` returns `[L, 21]`
log-probabilities: structure-only (`"none"`), given every other native residue
(`"all-but-self"`), or along a decoding order. The test fixture
`test/fixtures/proteinmpnn_v_48_020.safetensors` holds v_48_020.

Numerics: on the same fp16-rounded weights the GPU forward pass matches upstream
PyTorch within 1.3e-4 in log-probability. Rounding the checkpoint to fp16 costs
more: against the original fp32 v_48_020 weights, log-probabilities move by up
to 1.4e-2 (mean 8e-4) on 1CRN, 1EMA and 1A4Y, and the argmax residue agrees at
99.9 to 100% of positions (95.7% for 1CRN all-but-self, where two positions are
near ties). Convert without `.to(torch.float16)` for fp32 weights at twice the
size. Layer counts come from the checkpoint's weight names
(`ProteinMpnn.layers`); the remaining constants (message scale 30, 16 RBFs over
2–22 Å, relative offsets clipped to ±32, the virtual-CB coefficients) are
upstream architecture, not learned values.

Pass a `ProteinMpnnTrace` as `{ trace }` to `encode` and `decode` to record the
forward pass: every activation in dispatch order, with its stage, layer, step
name, the checkpoint weights it read, and the shape the model computed. The
trace keeps its own `[L, C]` copy of each (edge activations as their mean over
the K neighbours) until `release()`, so a renderer can bind them while the model
still frees its temporaries. Tracing does not change the outputs.
`deno run -A scripts/trace_proteinmpnn.ts 1crn trace.json [--values]` writes the
same trace for a fixture or a `.bcif` file as JSON, for replaying a structure's
pass outside the browser.

## Model layouts

A `ModelLayout` lists a model's 2-D weight matrices (PyTorch `[out, in]`)
grouped into stages, with no data and no renderer. `layoutFromSteps` builds one
from a recorded forward pass, such as `ProteinMpnnTrace.steps`: each matrix
joins the stage that first reads it, in reading order. `layoutFromNames` builds
one from names alone for models that cannot run here: numbered blocks in numeric
order, embeddings first, heads last. It collapses numbered copies such as MoE
experts into one matrix with a `count`; pass `{ collapseCopies: false }` to
retain exact tensor names when binding real weight buffers. It drops
quantization scales and reports FP4 weights packed two per byte at their logical
shape, so DeepSeek-V4 and Kimi-K3 layouts read correctly.
`readSafetensorsHeader` reads names, dtypes and shapes from a file's first
`8 + safetensorsHeaderLength(bytes)` bytes, so a 7B checkpoint's layout costs
two range requests. `scripts/catalog_model_shapes.ts` writes such a catalog for
Hugging Face repos (single-file or sharded) and local files, and rejects servers
that do not honor byte ranges before reading their response bodies.

## Ownership

Tensors created by `upload`, `uploadIndex`, `uploadWeights`, `copy` or an op are
_owned_. They live until `release(t)` or `destroy()`, which first submit any
recorded work that may read them. `wrap(buffer, shape)` views a buffer you own
and never destroys it. Ops record into one command encoder; `flush()` submits
it, and `read()` flushes and copies a tensor back to the CPU.

## Dependency graph

`nn` is a leaf: it imports nothing from the workspace. It must not import
`@use-gpu/*` or `molstar`. Viewer integration (binding a weight or activation
buffer to a representation) belongs in `@molgpu/viewer`.

## Testing

`deno test -A packages/nn/test/ops.test.ts` checks the CPU references against
hand-derived values. `deno task test:nn:gpu` checks every kernel against its CPU
reference on Deno's built-in WebGPU, and ProteinMPNN against upstream PyTorch
log-probabilities (`scripts/proteinmpnn_reference.py`) on 1CRN, 1EMA and the
two-chain 1A4Y. It needs a GPU adapter (a software adapter such as llvmpipe
works, slowly).

## API

_stable_: relied on by other packages and settled. _experimental_: may change in
0.x minor releases.

| Export                    | Stability    | Description                                                                                       |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `Tensor`                  | experimental | Dense row-major float32 CPU tensor: `shape` and `data`.                                           |
| `IndexTensor`             | experimental | Dense row-major `Uint32Array` tensor of row indices, such as a `[L, K]` neighbour list.           |
| `tensor`                  | experimental | Build a `Tensor` from a shape and values (copied), or zero-filled.                                |
| `indexTensor`             | experimental | Build an `IndexTensor` from a shape and indices (copied).                                         |
| `elementCount`            | experimental | Number of elements in a shape; rejects non-integer or negative dimensions.                        |
| `erf`                     | experimental | Error function in double precision, the reference for exact GELU.                                 |
| `gelu`                    | experimental | Elementwise exact-erf GELU (PyTorch `nn.GELU()` default).                                         |
| `Activation`              | experimental | Activation fused after `linear`: `"none"` or `"gelu"`.                                            |
| `linear`                  | experimental | CPU reference of `x Wᵀ + b` with W in PyTorch `[out, in]` layout and an optional fused GELU.      |
| `LAYER_NORM_EPS`          | experimental | Default LayerNorm epsilon, 1e-5, as in PyTorch.                                                   |
| `layerNorm`               | experimental | CPU reference LayerNorm over the last axis (biased variance), optionally of `x + residual`.       |
| `gatherRows`              | experimental | CPU reference row gather `x[index]`, ProteinMPNN's neighbour lookup.                              |
| `neighborSum`             | experimental | CPU reference masked sum over the K neighbour axis of `[L, K, C]`, divided by a scale.            |
| `logSoftmax`              | experimental | CPU reference numerically stable log-softmax over the last axis.                                  |
| `parseSafetensors`        | experimental | Read a safetensors checkpoint into named f32 tensors (F32, F16 and BF16 inputs).                  |
| `GpuTensor`               | experimental | A tensor in a `GPUBuffer` (`f32` or `u32`), and whether the runtime owns it.                      |
| `NnRuntime`               | experimental | Runs the ops as WGSL compute on a caller-supplied `GPUDevice`; owns the buffers it creates.       |
| `concat`                  | experimental | CPU reference last-axis concatenation; a `[L, C0]` side broadcasts over `[L, K, C1]`.             |
| `mix`                     | experimental | CPU reference per-row blend `mask * a + (1 - mask) * b`.                                          |
| `PROTEIN_MPNN_ALPHABET`   | experimental | ProteinMPNN's 21-letter alphabet `ACDEFGHIKLMNPQRSTVWYX`; index 20 is unknown.                    |
| `BackboneSource`          | experimental | Structure columns `proteinMpnnInput` reads; molgpu's `StructureData` satisfies it.                |
| `ProteinMpnnInput`        | experimental | Backbone N/CA/C/O, residue index, chain, native sequence and source residue rows.                 |
| `proteinMpnnInput`        | experimental | Extract ProteinMPNN input from the first model's complete-backbone protein residues.              |
| `PROTEIN_MPNN_ATOM_PAIRS` | experimental | The 25 backbone atom pairs each edge's RBF features encode, in feature order (16 features each).  |
| `PROTEIN_MPNN_NEIGHBORS`  | experimental | Neighbours per residue in the published checkpoints (48).                                         |
| `ProteinMpnnGraph`        | experimental | k-nearest-neighbour graph with RBF and positional edge inputs, for inspecting the model's graph.  |
| `proteinMpnnGraph`        | experimental | Build the neighbour graph and edge features on the CPU (as upstream `ProteinFeatures`).           |
| `ProteinMpnn`             | experimental | ProteinMPNN forward pass on an `NnRuntime`, reading weights under their PyTorch state_dict names. |
| `ProteinMpnnEncoding`     | experimental | Encoder output: graph, GPU neighbours, per-layer node embeddings and final edge embeddings.       |
| `ProteinMpnnVisibility`   | experimental | Which native residues the decoder sees: `"none"`, `"all-but-self"`, or a decoding order.          |
| `SafetensorsEntry`        | experimental | One tensor as a safetensors header describes it: dtype, shape and byte range, without data.       |
| `safetensorsHeaderLength` | experimental | JSON header length from a file's first 8 bytes.                                                   |
| `readSafetensorsHeader`   | experimental | Tensor names, dtypes and shapes from a safetensors header; the data section need not be present.  |
| `ModelLayout`             | experimental | A model's 2-D weight matrices grouped into stages in forward order, renderer- and data-free.      |
| `LayoutStage`             | experimental | One stage of a layout: a label and its matrices.                                                  |
| `LayoutMatrix`            | experimental | One matrix of a layout: checkpoint name and `[out, in]` shape.                                    |
| `LayoutStep`              | experimental | A recorded step `layoutFromSteps` reads: stage, layer and the weights it read.                    |
| `layoutFromSteps`         | experimental | Layout from a recorded forward pass, in the order the weights are first read.                     |
| `layoutFromNames`         | experimental | Layout from weight names alone, grouping numbered blocks, for models that cannot run here.        |
| `layoutParameters`        | experimental | Number of weights in a layout's matrices.                                                         |
| `ProteinMpnnRunOptions`   | experimental | Options for `encode` and `decode`: a trace to record into.                                        |
| `ProteinMpnnTrace`        | experimental | Records every activation of a forward pass and owns its copies until `release`.                   |
| `ProteinMpnnStep`         | experimental | One recorded activation: stage, layer, name, weights read, model shape and `[L, C]` values.       |
| `ProteinMpnnStage`        | experimental | Part of the network a step belongs to: features, encoder, sequence, decoder or output.            |
