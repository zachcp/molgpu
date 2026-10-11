# Bezbox follow-ups and GitLab use.gpu 0.21 adoption

Date: 2026-10-11. Branch: `codex/bezbox-primitive-spike`. Tracking:
`molgpu-sept-erf`, `molgpu-sept-gvq`, `molgpu-sept-mik`. This follows the
[research spike](2026-10-11-bezbox-primitives-spike.md). The owner explicitly
authorized GitLab 0.21 adoption after that report; the report's original
recommendation to wait is superseded by this implementation.

## Result

The three issues were delegated in parallel with separate file ownership and
integrated on the same branch. The data/props cleanup and FieldArrows pilot did
not require waiting for the dependency investigation. Final acceptance used the
combined implementation on exact `0.21.0-rc.2` artifacts.

- FieldArrows now has a small Live component, documented `FieldArrowsProps` and
  strict option normalization in `field-arrows-options.ts`, and shader builders
  in `field-arrows-shaders.ts`. It still uses native ArrowLayer and
  shader-derived attributes, with the same memoization and ownership. There is
  no new trait framework, general schema compiler or Plot aggregation step.
- Trajectory and Volume caller contracts are colocated in `trajectory-props.ts`
  and `volume-props.ts`. Their public entry exports, source unions, defaults and
  behavior are unchanged. The only API snapshot change is the explicit exported
  FieldArrowsProps alias replacing that component's inline prop declaration.
- The root and affected Deno manifests and lock use GitLab `0.21.0-rc.2`.
  Timeline's private easing adapter and Tube's spline helper import Math.
  Loop/event/picking-ID/queue imports use Frame. GPU device, geometry, material,
  source binding and rendering imports remain in Workbench/Core.

No package.json, extra workspace package, upstream patch, vendored dependency,
publication, deployment or remote push was introduced.

## Dependency provenance and consumer requirements

The project-local `.npmrc` scopes only `@use-gpu` to:

```ini
@use-gpu:registry=https://gitlab.com/api/v4/projects/27922731/packages/npm/
```

Deno's lock records the artifact URL and integrity for each of the twelve
installed use.gpu packages. The resolved viewer graph contains exactly one copy
of each, all `0.21.0-rc.2`, including Live and Frame. Selected artifact SHA-1s:

| Artifact  | SHA-1                                      |
| --------- | ------------------------------------------ |
| core      | `4a0a40b3398cd1f7535b5e869db69051a8b9b528` |
| frame     | `d17212fe22e627846a4e1ae5d164763e384ebdfe` |
| math      | `ad72b8e432481c9e296c6b1706195265c0e9e571` |
| live      | `924a1fa1d9d6790bc4ee152a3d7590c82d348681` |
| workbench | `901a089d7fd91e484ed6ee835f0943fac8d73eeb` |

The
[Math artifact](https://gitlab.com/api/v4/projects/27922731/packages/npm/@use-gpu/math/-/@use-gpu/math-0.21.0-rc.2.tgz)
is available in rc.2, unlike the rc.1 URL checked in the research spike. The
registry's package metadata and untouched tarballs were inspected directly.

Consumers of this branch require that scoped registry configuration and
`"nodeModulesDir": "auto"` in their Deno manifest. The exact rc.2 upstream
manifests omit some sibling imports: Frame imports Parse and Traits, and
Workbench imports Math, without declaring all of them. Deno's global-cache-only
bundle failed on those omissions; its local node_modules mode resolves the
installed sibling packages. This setting is exercised in the isolated consumer,
not assumed from a successful workspace build. No extra application dependency
or upstream file patch was needed.

The consumer gate still checks actual divergent-copy incompatibility. GitLab
lacks stable 0.19.0, so its comparison uses available `0.19.0-rc.11` packages
with current Math/Frame (which did not exist on that older line). Both Live
versions must resolve, and the check must fail with the observed TS2322
OrbitCameraProps mismatch, not a package-download error. Overriding only Live
can still type-check because its types are structurally compatible; that is not
a supported mixed-version configuration. Match the exact pin.

## Runtime migration discovered by integration

The rc.2 native dispatch record changed from `compute` to `computePre` or
`computePost`. Our dispatch observer intercepted Kernel output using the old
key, so it dropped native compute work. EField stalled in `updating`; a
trajectory composition read unwritten output. These failures were reproduced in
browser acceptance before the fix.

`dispatch-observation.ts` now preserves the phase key emitted by the native
Kernel. It still uses the native countDispatch callback to distinguish an
encoded dispatch from a suppressed one. Its existing microtask publication runs
after ComputePass's synchronous submission, not after GPU completion. No timer,
root-coordinate fallback or weakened readiness check was added. EField and
trajectory acceptance passed after this change; retained draw/dispatch/readback
retirement was then checked separately.

The site retained a Vite cache pointing to the removed 0.20.0 package path.
Adding Math and Frame to its prebundling/deduplication configuration updates
that cache and covers the new imports; the shared browser harness also
prebundles Frame. This is distinct from a shader or scientific failure.

## Validation

Passed on the combined implementation:

- Workspace CPU run: 566 passed with one local HTTP-server test blocked by the
  sandbox. The complete IO trajectory file then passed all 11 tests outside that
  socket restriction, covering the remaining test. No CPU assertion failed.
- Five executable trait/schema probes on rc.2 and the public JSX example with
  negative source-union checks.
- Full source/test type check, component type check and site type check.
- All eight packages H1–H6, with reviewed API snapshot; JSR dry run succeeded.
- EField and trajectory browser suites (including live compute, source handling,
  interpolation and the new independent width/tint/opacity/range invalidation
  assertions); Volume suite including shared storage and replacement/unmount.
- Combined browser run: 91 passed, 15 steps passed, 28 inapplicable cases
  ignored. This includes isolated JSR consumer, base GPU, Gate 2, Tube, picking,
  typed components, Superpose source handling, GPU DSSP, ElasticNetwork,
  invalidation and the full 11-part retirement runner. The only failure in that
  run was the stale site dependency cache described above.

The site rerun passed all maintained routes after the Vite configuration update
(49 seconds). Final repository formatting (650 files) and lint (429 files)
passed, along with scoped lint for changed scripts. This is a broad scoped gate,
not a claim that every repository GPU suite ran. In particular, the separate
surface/ribbon/material/postprocess suites were not part of this command. No
publication or deployment was used as validation.

Run logs were retained locally under `/private/tmp/molgpu-rc2-*.log`. Fresh raw
retirement evidence is in `/private/tmp/molgpu-rc2-retirement-evidence`; the
runner overwrites historical October 1 paths, which were restored after saving
the new outputs. Historical evidence is not silently relabeled as rc.2 evidence.
