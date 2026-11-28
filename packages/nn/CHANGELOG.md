# Changelog

All notable changes to `@molgpu/nn` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[release procedure](https://github.com/zachcp/molgpu/blob/main/docs/RELEASING.md)
for the procedure.

## [Unreleased]

- `tileMeanAbs` CPU reference and `NnRuntime.tileMeanAbs` GPU snapshots reduce
  non-empty matrices to 32 × 32 mean-absolute-weight tiles. Aligned input
  windows support buffers above the storage binding limit; partial tiles use
  real cell counts. The local model view renders oversized float matrices from
  these compact grids, preserving original geometry and labeling summary hover
  values.
- `ModelLayout` with `layoutFromSteps` and `layoutFromNames`, and
  `readSafetensorsHeader` for reading a checkpoint's shapes without its data;
  `scripts/catalog_model_shapes.ts` catalogues layouts from Hugging Face.
- `layoutFromNames` collapses mixture-of-experts copies (`LayoutMatrix.count`),
  drops quantization scales and unpacks FP4 shapes (`LayoutMatrix.dtype`).
- `{ collapseCopies: false }` retains exact tensor names for value-backed
  layouts. Local checkpoint views preserve FP4 metadata in header-only mode; the
  catalog reader requires partial responses and reuses the length prefix.
- Layout documentation and the model view distinguish name-derived grouping from
  traced first-use order, and checkpoint row/column axes from input/output
  roles. Matrix dimensions and data are not transposed.
- New package: CPU reference ops (exact GELU, linear, LayerNorm, row gather,
  masked neighbour sum, log-softmax), a safetensors reader, and `NnRuntime`, a
  raw-WebGPU runtime on a caller-supplied device whose tensor buffers can be
  bound by a renderer.
- `ProteinMpnnTrace` records a ProteinMPNN forward pass step by step, and
  `NnRuntime.copy` copies a tensor in dispatch order.
- `ProteinMpnn.layers` counts encoder and decoder layers from the checkpoint
  instead of assuming three.
- `PROTEIN_MPNN_ATOM_PAIRS` names the atom pair behind each block of 16 RBF edge
  features.
