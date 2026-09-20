# use.gpu 0.20.0: `instances` emits invalid WGSL for RawQuads layers

## Summary

Passing an `instances` source to `PointLayer` (and therefore the underlying
`RawQuads` path) makes generated WGSL declare an instance loader returning
`void`:

```wgsl
fn _0a_loadInstance(a: u32) -> void { ... }
```

WGSL has no `void` type, so the shader fails validation and the layer draws
nothing. The expected behavior is to use each `u32` value as the random-access
row index, allowing a small selection buffer to drive the full bound columns.

## Reproduction

Pinned environment: `@use-gpu/{live,workbench,webgpu,core,shader,wgsl}` 0.20.0,
Chrome 150 on macOS arm64 with WebGPU enabled.

From this checkout:

```sh
cd spikes/examples
npx vite .
# Open http://localhost:5185/?ex=instances in a fresh tab.
```

The intentionally minimal repro is
[`instances.mjs`](../../spikes/examples/ex/instances.mjs). It binds two
`vec3<f32>` positions and a two-row `u32` `instances` source to `PointLayer`.
Without `instances`, both points render. With it, Chrome reports the invalid
`loadInstance` WGSL return type and neither point renders.

## Expected / actual

Expected: two points render in the order selected by `Uint32Array.from([1, 0])`.

Actual: generated shader validation fails because its instance loader returns
`void`.

## Impact and workaround

This blocks zero-copy selection for all RawQuads-based layers. MolGPU currently
uses a correctness fallback that gathers selected positions, colors, and radii
into compact arrays before binding `PointLayer`; see
[`spacefill.mjs`](../../spikes/examples/lib/spacefill.mjs). The fallback must
remain until the generated source mapping and rendering match gather behavior.
