# JSR Consumers and Multi-Copy Identity (crj.11)

Date: 2026-09-29. Bead: `molgpu-sept-crj.11`. Base: main at `2de7039`. Evidence:
[evidence/2026-09-29-jsr-consumer.json](evidence/2026-09-29-jsr-consumer.json).
Acceptance example: `deno run -A test/spikes/jsr-consumer/run.ts --browser`.

## Question

Workspace type checks, `deno publish --dry-run` and `check:hardening` pass, but
every browser test aliases the `@molgpu/*` entries to this checkout. Does a
consumer outside the workspace, resolving the packages as JSR would, get a
working application? What happens when a consumer ends up with two copies of
`@molgpu/table`, `@molgpu/timeline` or use.gpu?

## Method

`test/spikes/jsr-consumer/registry.ts` is a local stand-in for jsr.io.
`deno publish` with `JSR_URL` pointing at it uploads each package's real publish
tarball: the files jsr.io would store, with workspace and import-map specifiers
already rewritten. Consumers in the OS temp directory, outside any workspace,
resolve `jsr:@molgpu/*` from those files. Nothing is sent to jsr.io.

`run.ts` then:

1. type-checks an import of all ten public entries and measures each entry's
   static module graph (`deno info`, ignoring dynamic imports);
2. type-checks and bundles `scene.tsx`, a JSX scene written only against public
   entries (`deno bundle --platform browser --code-splitting`), and with
   `--browser` renders the bundle in WebGPU Chrome, preloaded and from BCIF;
3. publishes compatible (`0.1.1`) and divergent (`0.2.0`) copies of `table` and
   `timeline`, runs `probe-copies.ts` against each, and type-checks the scene
   with a consumer on use.gpu `0.19.0`.

## Results

**Published dependency form.** Every package publishes fully unfurled
specifiers. Internal dependencies become ordinary caret dependencies
(`jsr:@molgpu/table@^0.1.0`); use.gpu becomes exact npm dependencies
(`npm:@use-gpu/live@0.20.0`, and `npm:/@use-gpu/core@0.20.0/mjs/ease.mjs` in
`timeline`). Mol* is `npm:/molstar@^5.11.0/...`, a caret range, while the
workspace and every test resolve exactly `5.11.0`. JSR has no peer mechanism;
nothing is published as a peer.

**Entries.** All ten entries type-check outside the workspace. Static cost:

| Entry                     | Modules |   Bytes | npm (static)                          |
| ------------------------- | ------: | ------: | ------------------------------------- |
| `@molgpu/table`           |      13 |  84,761 | none                                  |
| `@molgpu/geo`             |       5 |  33,927 | none                                  |
| `@molgpu/timeline`        |       2 |  17,353 | `@use-gpu/core`                       |
| `@molgpu/select`          |      20 | 179,273 | none                                  |
| `@molgpu/fields`          |      18 | 135,678 | none                                  |
| `@molgpu/dynamics`        |      24 | 360,350 | none                                  |
| `@molgpu/dynamics/wgsl`   |      12 |  86,703 | none                                  |
| `@molgpu/io`              |      28 | 173,141 | none (Mol* only via `import()`)       |
| `@molgpu/viewer`          |     136 | 988,201 | use.gpu core, live, shader, workbench |
| `@molgpu/viewer/advanced` |      54 | 314,232 | use.gpu live, shader, workbench       |

**JSX scene.** The scene type-checks and bundles. The page loads three chunks
(1.91 MB unminified) of 3.73 MB; 56 chunks, including every Mol* module, are
reached only through `import()`. In Chrome the preloaded scene draws (3,980 lit
pixels) with no errors and fetches no Mol* chunk; the BCIF scene draws (54,806
lit pixels) with no errors after fetching six Mol* chunks (`cif`, `mmcif`,
`mol-task` and three structure-property modules).

**Direct Deno import of the viewer fails.** `import("@molgpu/viewer/advanced")`
in a Deno program fails to link:
`@use-gpu/workbench@0.20.0 does not provide an
export named 'LoopContext'`. The
package has no `exports` map or `"type"`, so Deno loads its CommonJS `main`,
whose `_export_star(require(...))` re-exports are invisible to static
named-export detection. Bundlers use its `module` field and work. The viewer is
browser-only, but the constraint is undocumented: a consumer must bundle it, and
Deno-run tests cannot import viewer modules that reach `@use-gpu/workbench`.

**Compatible copies deduplicate.** A consumer requiring `table@0.1.1` and
`timeline@0.1.1` while `select`, `fields` and `viewer` require `^0.1.0` gets a
single module instance of each (`sameTableModule`, `sameTimelineModule`), and
every cross-package case succeeds.

**Divergent copies fail partly.** With the consumer on `0.2.0` and the other
packages on `^0.1.0`, each package has its own copy:

| Case (the other copy operating on the consumer's value) | Outcome                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `table.activeAtoms`                                     | succeeds, correct rows                                             |
| `table.attributeColumn`                                 | succeeds                                                           |
| `select.resolve`                                        | succeeds, correct rows                                             |
| `fields.evaluate`                                       | succeeds, correct values                                           |
| `table.withAttributes`                                  | `TypeError: identity: expected a structure created by this module` |
| `table.bondTopology`                                    | same `TypeError`                                                   |
| `timeline.sample`                                       | `TypeError: curve must be created by createCurve`                  |

Reads of immutable data work across copies. Operations that need the
module-private identity registry (revisions, caches, curve state) fail
explicitly, but their messages do not name the likely cause, a second copy.

**Divergent use.gpu fails at type checking.** A consumer on use.gpu `0.19.0`
gets Live `0.19.0` and `0.20.0` in one graph, and `scene.tsx` fails to
type-check (`OrbitCameraProps` mismatch). No `0.20.x` other than `0.20.0` exists
today, so the viewer's exact pin cannot currently split from `@use-gpu/webgpu`'s
`^0.20.0` range. A future `0.20.1` could: the consumer and `@use-gpu/webgpu`
would take it while the viewer stays on `0.20.0`, giving two Live copies with no
type error.

## Decision

1. **Keep eight packages and the current entries; add no subpaths.** Package
   independence holds under publish-equivalent resolution: each entry resolves,
   type-checks and bundles on its own, `io` keeps Mol* lazy, and a real scene
   renders from the published files. The viewer root's 136-module graph is the
   cost of one component entry; nothing in the evidence calls for splitting it.
2. **Keep module-private identity.** Compatible caret ranges deduplicate to one
   copy. Divergent copies must not interoperate silently, and today the
   operations that depend on identity fail explicitly. Improve their messages to
   name a duplicate package copy; do not add cross-copy registries.
3. **Replace npm-peer claims with the JSR contract.** `@molgpu/*` packages
   depend on each other through caret ranges that Deno resolves to one copy when
   compatible; use.gpu is an exact dependency that the application must match
   exactly; the viewer must be bundled.
4. **Verify the published form, not a fabricated npm manifest.** The hardening
   dependency check should read what `deno publish` actually uploads, which the
   local registry makes possible.

### Alternatives considered

- **A global identity registry** (`Symbol.for` or `globalThis`) would let
  divergent copies share structures. Rejected: it hides incompatible versions
  and defeats the revision contract.
- **Structural validation instead of identity** would accept any well-formed
  object. Rejected: identity carries revision provenance that shape cannot.
- **Real peer dependencies.** JSR has none; the working mechanism is compatible
  caret ranges, which the evidence shows deduplicate.
- **Loosening the use.gpu pin to `^0.20.0`.** Would make a future patch dedupe,
  but contradicts the reviewed exact pin (AGENTS.md). Left as a decision for the
  next use.gpu upgrade; document the exact-match requirement now.

## Follow-ups

Filed under `molgpu-sept-crj`, discovered from `crj.11`:

- `crj.16` (blocks `crj.13`): replace npm-peer language in the package READMEs
  and `docs/HARDENING.md` with the JSR contract above, including the bundler
  requirement for the viewer.
- `crj.17` (blocks `crj.13`): check the unfurled published manifests in
  `check-hardening.mjs` H1 (via the local registry) instead of fabricated npm
  metadata, and decide whether `run.ts` joins CI.
- `crj.18`: name the duplicate-copy cause in the table identity and timeline
  curve errors.
- `crj.19`: decide `@molgpu/io`'s Mol* range: publish the tested exact version,
  or test the caret range it currently publishes.
