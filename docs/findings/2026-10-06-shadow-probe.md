# Shadow casting per viewer representation (molgpu-sept-jcc)

Date: 2026-10-06. use.gpu 0.20.0 (pinned), Chrome with WebGPU, run locally on a
Mac. Unblocks the site figure mode (molgpu-sept-0z3.9).

## Question

Under `<Pass lights shadows>` with a shadow-mapped `<DirectionalLight>`, which
`@molgpu/viewer` representations cast shadows, and are those shadows correct?

## Method

The site's Compose example has a figure mode: a ground plane under the
structure's coordinate bounds, SSAO, and a key light with an orthographic shadow
map sized to those bounds (`site/src/demos/figure.ts`). The site browser suite
(`deno task test:site`, Compose route) turns it on and, for each representation
alone, counts draws in use.gpu's depth-only shadow pass. It wraps
`GPUCommandEncoder.prototype.beginRenderPass` and counts the draws in passes
labelled `<ShadowPass> Atlas #n`. The ground plane is one draw. A layer casts
if, and only if, it adds draws there. This is a direct signal, unlike pixel
differences. An earlier pixel-diff version was misled by stale on-demand frames
while shadow pipelines compiled: it reported tube "shadows" that the draw count
shows do not exist.

## Result (default props, as the Compose example uses them)

| Representation             | use.gpu layer           | Casts | Notes                                                           |
| -------------------------- | ----------------------- | ----- | --------------------------------------------------------------- |
| `<Cartoon>`                | FaceLayer, shaded       | yes   | `RawFaces` defaults `shadow = shaded`; the shadow looks correct |
| `<Tube>`                   | LineLayer (shaded tube) | no    | `RawLines` defaults `shadow = false`; no public `shadow` prop   |
| `<BallAndStick>`           | PointLayer + bond lines | no    | No public `shadow` prop                                         |
| `<Spacefill>`              | PointLayer (billboards) | no    | Default `shadow = false` (see opt-in below)                     |
| `<Surface opacity={0.15}>` | FaceLayer, transparent  | no    | Transparent draws are not in the shadow pass                    |

Receiving: the ground plane (a PBR `FaceLayer`) and the cartoon both receive the
cartoon's shadow, and the plane's lit brightness is the same with shadows on and
off (sampled plane pixels 140 vs 141).

The opaque `<Surface>` and `<Ribbon>` use shaded FaceLayers like `<Cartoon>`, so
by source they cast. They were not probed in figure mode, because the site only
offers figure mode on Compose, where the surface is the glass layer.

## Spacefill opt-in is wrong

`<Spacefill shadow>` (public through `PointLayerOptions`) does add a shadow
draw. The shadow is far too large, though: most of the plane and every atom go
dark. `WorldSpacePointLayer` converts Å radii to PointLayer's camera-normalized
size using the view camera. In the light's orthographic shadow view the quads
come out much too large. Do not enable it. The fix belongs to the
sphere-impostor spike (molgpu-sept-x0p): a world-space ray-cast sphere would
give correct depth in both views. use.gpu 0.20.0's PointLayer also has a
`raytrace` option worth checking there.

## Consequences

- The site figure mode ships with these limits. Only the cartoon (and, by
  source, opaque surfaces and ribbons) casts. Atoms and tubes are lit and get
  SSAO but cast no shadow.
- Giving `<Tube>` and `<BallAndStick>` a `shadow` option would be a public
  viewer API change. It is filed as a follow-up and not done here.
- `<Loop converge>` from the upstream SSAO demo is not used. The site renders on
  demand, and SSAO with its built-in reprojection already looked stable at rest
  in this run. Revisit it if figure exports show noise.
