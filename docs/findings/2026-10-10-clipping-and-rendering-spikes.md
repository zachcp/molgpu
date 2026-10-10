# Clipping acceptance and rendering spikes

Date: 2026-10-10. Baseline: main `68d9b6a`. Branch:
`codex/clipping-and-rendering-spikes`. Beads: `molgpu-sept-icj.3`, `icj`, `x0p`,
`rze`; shortened IDs below have the same prefix. Chrome 154.0.8037.98 on macOS,
using the repository's native WebGPU browser arguments. No package API changes,
dependency upgrades, deployment or publication.

## Surface clipping (`icj.3`, `icj`)

The earlier failure compared background pixels before the asynchronous clipped
surface had drawn. The existing generic canvas readiness could observe the newly
visible BallAndStick atoms alone. A neutral opaque surface should instead
establish the baseline, and each cut should reach a real surface draw before its
pixels are compared.

Reproduced a related production cause: the first cut changed the scene from
Surface to ClipSlab > Surface and added an atom sibling. That remounted the
surface and scheduled its CPU field/mesh again. With surface pipeline
publication deliberately delayed by 1.5 seconds, the original test accepted red
atoms before the new surface draw. Instrumentation then reproduced exactly one
surface mesh rebuild on the first cut, with zero root-coordinate upload. This
establishes a site composition/invalidation defect; it does not establish
incorrect clipping-plane math.

The site now retains a keyed ClipSlab around Surface, with both half-space
providers always mounted. An absent endpoint binds `[0, 0, 0, 1]`, a constant
positive plane in the installed `getScissorPlane` implementation. Enabling,
moving and disabling either cut updates uniforms. Atoms remain outside the clip
scope, as intended by the demo. No viewer resource framework or public API was
changed.

The browser test observes nonempty FaceLayer draws by identifying the pinned
`getFaceVertex` shader and its render pipeline. Surface is the only face layer
on this route. It waits for a surface draw and then
`GPUQueue.onSubmittedWorkDone()` before the pixel baseline and both cut
measurements. The artificial pipeline delay is a stress input, never proof of
GPU completion. First demand for the atom representation can upload immutable
atom/bond attributes; the test distinguishes that from rebuilding the surface or
uploading root coordinates.

Isolated fixed acceptance:

- Front cut: red pixels 0 → 2,589; surface mesh builds 0, root-coordinate
  bytes 0.
- Back cut: background pixels 362,968 → 388,362; all geometry builds and upload
  bytes 0 while moving the existing slab.
- Default full surface, accessible/excluded modes, glass/pumice materials and
  their uniform changes retain the existing browser acceptance.

Executable acceptance: `MOLGPU_SITE_DEMO=surface deno task test:site`, plus the
full `deno task test:site`. The initial full run with the draw-readiness repair
passed all routes. A later full run with the stable scene stopped at an
unrelated Compose cartoon sheet-pixel assertion (109 pixels instead of its
minimum); it did not reach Surface. This is recorded separately from clipping
and was rerun without competing browser workloads. The final complete run with
the stable slab passes all five routes in 54 seconds, including the first-cut
regression, shadow probes, focus and Motion snapshot budgets.

## Sphere impostors (`x0p`)

Decision: retain the current shaded PointLayer for camera rendering. Do not
replace it merely to add ray-tracing: it already has that behavior. Keep sphere
shadow correction as the bounded follow-up `molgpu-sept-hr8`; the experimental
sizing candidate is not promoted to production.

Installed use.gpu 0.20.0 source establishes the path:

1. `layers/point-layer.mjs` binds `traceSphereQuad` when `shaded` is true.
2. `primitives/raw-quads.mjs` combines it with `getRaytraceSurface` and sets
   `HAS_DEPTH` for shaded draws.
3. `mask/sphere.wgsl` solves ray/sphere intersection and returns the hit's world
   position, normal and `worldToDepth` value.
4. `render/forward/shadow.mjs` has a separate depth-vertex selection path;
   RawQuads supplies a solid quad as `getVertexDepth`. The camera-side size
   conversion and the shadow vertex/surface contract both need examination.

The old inference that PointLayer has approximate per-pixel sphere depth was
incorrect. The September S1 evidence (`cqm.1`, closed) already established true
sphere intersection seams; the fresh comparison provides a stronger executable
oracle rather than reopening that completed issue.

`packages/viewer/test/sphere-spike.html` and `run-sphere-spike.mjs` compare two
intersecting unit spheres against a 96×48 tessellated mesh with matching
positions, colors and outward normals. NormalMaterial makes wrong depth order or
hit normals visible at the intersection. A test-only candidate computes
`2 * radius / getWorldScale(1, 1)` in WGSL, reading pass uniforms instead of the
JavaScript camera scale. It uses the same native PointLayer and radii sources,
with no raw WebGPU rendering implementation.

Each structural pass scenario mounts independently. Readiness counts object
draws specifically in ColorPass, excluding shadow/normal prepasses and the
ground plane, then drains submitted work. Early probe captures that counted
shadow draws could be blank before the color pipeline was ready; those results
were discarded. Also, toggling SSAO flags on one mounted Pass reproduced a
bind-group mismatch in the experimental fixture. Independent mount scenarios
follow the existing postprocess harness pattern; this spike does not claim
support for changing a mounted Pass's flags.

| Measurement                            | Current PointLayer | Pass-aware size candidate |
| -------------------------------------- | -----------------: | ------------------------: |
| Visible union pixels against mesh      |             20,428 |                    20,428 |
| Mean RGB channel error vs mesh (0–255) |             2.2512 |                    2.2512 |
| Fraction with summed RGB error > 60    |              1.50% |                     1.50% |
| 100k update + queue completion median  |           17.53 ms |                  17.02 ms |
| 100k update + queue completion p95     |           30.86 ms |                  19.33 ms |

The 100k fixture moves the camera for 20 samples and changes roughness; it
allocates no new storage buffers. These timings include CPU work, Playwright
polling and queue completion. They are not GPU timestamps, a controlled
benchmark or evidence of a performance improvement. The historical S1 frame
cadence remains historical evidence, not a replacement for profiling a future
production correction.

For ground-shadow scenes, summed screenshot RGB was 24,717,972 for the mesh and
23,274,864 for both native point variants. This aggregate demonstrates a
remaining image discrepancy, but does not locate or quantify a shadow defect. It
does not prove that shader-side size conversion fixes the earlier oversized
Spacefill shadow. The October 6 shadow probe and pinned source remain the
concrete reason to investigate casting. No new correct-shadow claim is made.

The candidate's mounted SSAO scene runs without WebGPU errors. Existing
postprocess acceptance passes SSAO/outline/OIT and replacement; existing picking
acceptance resolves the expected atom and click. The full site tests exercise
environment changes, but a pixel oracle for sphere reflections or candidate
picking is not supplied by these checks. Those are explicit acceptance
requirements of `hr8`, together with orthographic, off-axis, near-plane and
lifetime cases. Keeping production PointLayer preserves the existing tested
picking/material paths.

Alternatives:

| Option                                | Decision                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Keep shaded PointLayer                | Chosen for camera rendering; existing ray-hit depth and normals are verified.                                                |
| Add a depth patch to PointLayer       | Rejected as a premise: visible depth is already ray-traced. Examine its separate shadow path instead.                        |
| Instanced mesh spheres                | Keep as a correctness oracle; a production change needs measured memory/vertex cost at equal apparent radii.                 |
| Custom world-space FaceLayer impostor | Reserve for a demonstrated native limitation; must preserve material, scissor, picking and shadow contracts before adoption. |

[Saved sphere report](evidence/2026-10-10-sphere-spike.json). Run:
`deno test -A packages/viewer/test/run-sphere-spike.mjs`. This is a spike
fixture, not a new representation or a full viewer GPU gate.

## Single HTML without a local bundler (`rze`)

Decision: the published-JSR CDN bridge is feasible for a small online example.
Restore `examples/hello.html` and its focused acceptance from the preserved
stash; leave unrelated nine-view/Squint pages and coverage work in the stash.
The root README links the recovered example. Stash history is untouched.

The file uses a native import map, public molgpu 0.2.0 APIs and exact use.gpu
0.20.0. esm.sh converts JSR TypeScript into browser ESM. Its documented `/tsx`
loader compiles inline classic Live JSX in the browser; this endpoint is
unversioned. Trying to treat `/tsx@VERSION` or the package's normal export as
that auto-running loader did not execute the page. Retain the documented loader,
and expose the graph limitation instead of inventing a pin.

Fresh browser launches pass visible 1CRN rendering, rotation/zoom/reset,
missing-WebGPU messaging and error-free pagehide unmount over localhost and
`file://`. The static server serves the HTML verbatim. The tests consume
published packages rather than this branch's viewer source, so they do not
validate unreleased viewer changes. The molecular loader needs a browser
`setImmediate` shim for CDN Mol* parsing. No font assets are requested. The JSX
transformer's WASM compiler was requested in the HTTP scenario; absence of that
request in the file scenario does not prove offline independence.

Approximately 791–792 requests were observed, including the remote module graph.
One earlier file-origin run rendered the molecule but encountered a CDN HTTP
500; the final no-error run is separate evidence, not a retry mechanism that
hides such failures. Timings and requests are uncontrolled network observations,
not guaranteed cold-CDN measurements.

Alternatives are native raw JSR imports (TypeScript and `jsr:` are not directly
executable by browsers), a locally built bundle, an emitted/vendored module
graph with an import map, or one inline prebuilt bundle. Choose the CDN bridge
when online no-local-build execution matters. A local bundle is preferable for
offline/controlled distribution, at the cost of a build step. Font-bearing or
WASM-dependent future representations need their own asset checks.

`molgpu-sept-zfi` scopes dependency-graph reduction, controlled measurements and
an immutable loader/plain-JavaScript alternative. The recovered HTML and
`examples/README.md` are the acceptance example and usage guide. Run:
`deno test -A examples/test/run-browser.mjs`.

The final run reached visible pixels in 4.182 seconds over HTTP and 6.357
seconds over `file://`, with no failed requests. The
[saved HTML report](evidence/2026-10-10-standalone-html.json) records both
protocols, their request counts and browser version.

## Verification scope

- Surface regression: original first-cut rebuild reproduced; fixed isolated
  route passes including the artificial pipeline delay and invalidation checks.
- Sphere spike: camera/mesh comparison, SSAO smoke, 100k storage reuse,
  queue-completion sampling and unmount pass.
- Existing postprocess and picking browser suites: two tests pass.
- Standalone CDN example: both HTTP and file URL checks pass.
- Site and public-components type checks pass; formatting and lint cover changed
  files, including extracted inline JavaScript/JSX from the HTML.
- No package source/API change was made, so no API snapshot or publishing gate
  is required. These checks do not constitute every viewer GPU suite.

Implementation and decision work is prepared on this branch. The four requested
Beads remain open/in progress until review and merge; the two bounded follow-ups
remain independently open.
