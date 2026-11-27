# Changelog

All notable changes to `@molgpu/nn` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[release procedure](https://github.com/zachcp/molgpu/blob/main/docs/RELEASING.md)
for the procedure.

## [Unreleased]

- `ModelLayout` with `layoutFromSteps` and `layoutFromNames`, and
  `readSafetensorsHeader` for reading a checkpoint's shapes without its data;
  `scripts/catalog_model_shapes.ts` catalogues layouts from Hugging Face.
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
