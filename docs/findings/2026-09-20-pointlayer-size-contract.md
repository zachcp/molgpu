# PointLayer `depth: 1` size contract

`PointLayer.sizes` is a camera-normalized **diameter**, not an Ångström radius.
The current use.gpu 0.20.0 shader constructs a rectangle from `±size / 2` and,
for a shaded `depth: 1` point, converts that rectangle into world coordinates
with:

```
world radius = (size / 2) * pixelRatio * viewScale * worldScale
```

`OrbitCamera` publishes `viewScale = radius * 2 * tan(fov / 2) / height` and
`worldScale = focus / radius`. Therefore an atom radius `r` in Ångström needs:

```
size = r * height / (pixelRatio * tan(fov / 2) * focus)
```

The camera radius cancels. Viewport height, DPR, FOV, and focus do not.
Orthographic mode uses the same published scale product, so the viewer reads
the live uniforms instead of branching on projection type.

`WorldSpacePointLayer` in `@molgpu/viewer` owns this derived size column. Its
callers retain the position and colour GPU sources, avoiding a size constant in
each representation. `packages/viewer/test/point-size.test.mjs` pins the
shader-equivalent formula for perspective, differing DPR/FOV/viewport values,
and orthographic scale publication. The browser-rendered `?ex=points` example
was also checked in Chrome with WebGPU on 2026-09-20.
