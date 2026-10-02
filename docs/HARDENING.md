# Library hardening standard (Phase 6)

The acceptance bar for epic `molgpu-sept-x24`. Every `@molgpu/*` package meets
**H1–H7**. The cross-cutting items **X1–X3** are met once, for the whole
workspace. A per-package bead is done when each H-item below is checked for that
package and the shared checks (`deno task check:hardening`) pass for it.

Tests are not introduced here. The golden-file harness and the existing suites
already exist; hardening only requires that they keep passing.

## Per-package criteria

**H1 — Manifest and published dependencies.** `deno.json` declares `name`, a
semver `version`, `license`, public TypeScript exports, and `publish.include`
containing `src`. Package licenses are MIT. JSR accepts only a single SPDX
identifier, so dynamics also ships the BSD-3-Clause PDB2PQR notice as
`LICENSE-PDB2PQR`. Check the files uploaded to a local JSR registry: internal
dependencies are caret `jsr:` ranges, use.gpu dependencies match the reviewed
exact npm pin, and no bare imports remain. Only IO may import Mol*, through
dynamic `import()`, at the tested exact version.

Compatible internal ranges must resolve a single table/timeline copy. Divergent
copies can reject values because identity and curve state are module-private;
inspect `deno info` and the lockfile, then align dependency ranges. The app must
match use.gpu `0.20.0` exactly. Bundle viewer entries for the browser: direct
Deno execution cannot link workbench's CommonJS `LoopContext` re-export.

**H2 — Types match the runtime.** Each `exports` entry's `types` and `import`
files exist (for TypeScript source they are the same `src/*.ts` file), and the
set of exported names is identical between them, as checked by script. It has no
`any` in public signatures, except where a comment explains why.

**H3 — No leaked dependency types.** For every package except `viewer`, the
public entry (and anything it re-exports) mentions neither `@use-gpu/*` nor
`molstar`. The viewer's `.` permits the pinned native `LiveElement` through
`ViewerElement` for typed scene composition (crj.9/crj.21). Other use.gpu types
belong to `@molgpu/viewer/advanced`. Because viewer modules host both entries,
`.` is checked export by export: each reachable external type must be exactly
`@use-gpu/live`'s `LiveElement`; `LiveComponent`, shader and GPU resource types
remain excluded.

**H4 — Import walls.**

- The only package that imports `molstar` at runtime, or declares it as a
  dependency, is `io`. Other packages may use Mol* only in test oracles, as dev
  dependencies.
- The only package that imports `@use-gpu/live`, `@use-gpu/workbench` or
  `@use-gpu/shader` is `viewer`.
- A lower package (`geo`, `timeline`) may import `@use-gpu/core` only from
  `src/internal/`. It must re-export what it needs under its own name, not pass
  the upstream binding straight through.

**H5 — Reviewed public API.**

- Each export is classified in the README as _stable_, _experimental_ or
  _advanced_. Anything internal is removed from the entry module. The checker
  reads this from a `## API` section containing a table whose rows start
  ``| `name` | stable |`` (further columns are free-form).
- A committed snapshot, `packages/<pkg>/api.txt`, holds the sorted export names
  and their declared signatures. The check fails when the snapshot and the
  source disagree, so an API change always shows up in the diff.
- Public declarations name only types the package exports from some entry. A
  private alias would show up in the generated docs with nothing to link to.
- Entry modules use explicit re-export lists; wildcard re-exports (`export *`
  and `export * as`) are rejected. `deno task check:hardening --usage` reports
  consumers by package, site, and tests for every entry export. An export with
  no workspace consumer needs a meaningful caller-facing description in the
  README API table, which is its explicit justification for the public surface.

  **Export discipline (R1–R6).** Apply this review guidance to every entry,
  including subpaths. Automated H5 checks enforce README classification,
  snapshots, named-type closure and explicit re-export lists; the usefulness of
  a named contract remains a review decision.

  1. Export a named component props type when callers need to name it
     independently. Inline concrete prop shapes and intersections of exported
     domain contracts are valid. Components with the same contract may share a
     props type (for example Ribbon and Cartoon share `RibbonProps`). For named
     union props, export the union; keep its variants internal.
  2. Export callback status/result types and public hook return types that
     callers need to name.
  3. Keep shared caller-facing domain aliases such as `ColorLike`, `Selection`,
     `Field`, and viewer `VectorLike` (plain/typed vectors accepted for colours
     and spatial values). Do not export an implementation utility solely because
     it is shared internally; use a concrete type or `ArrayLike<number>` when an
     alias has no useful caller-facing contract.
  4. Remove option bags with their removed owner function or component.
  5. List every public export explicitly; never use `export *` or
     `export type *` in an entry module.
  6. Export an options or report type only if callers must name it outside a
     call expression. Otherwise inline it in the public signature. A named type
     that remains in a public signature must itself be exported.

**H6 — Packs and imports cleanly.**

- `deno publish --dry-run` succeeds for the package: it type-checks, passes
  JSR's no-slow-types rule, and resolves every import as JSR will. Packages
  whose entries are TypeScript are imported under Deno instead of from the npm
  tarball, because Node won't strip types under `node_modules`.
- No import has to reach into `/src/internal`.

**H7 — README.**

- Covers purpose (one paragraph), install, dependency resolution, and a minimal
  runnable example.
- Lists the API with its stability level.
- Notes where the package sits in the dependency graph and what it must not
  import.

## Cross-cutting criteria

**X1 — Shared check tooling.** `deno task check:hardening [pkg]` automates H1–H6
(`--update` rewrites `api.txt`; `--json` for machine output). A per-package bead
is verified by running this script. The deliberately broken copy under
`test/hardening/fixture` can be passed to the script when checking failure
diagnostics.

**X2 — Invalidation and resource audit.** The change→work table in
`docs/findings/2026-09-17-architecture-review.md` is enforced by tests, not just
described:

- The viewer exposes dev-only counters for topology builds, geometry builds,
  gathers, allocations, upload bytes and binding updates.
- For each representation (Spacefill, Bonds, BallAndStick, Tube, Ribbon, Surface
  and annotations), a test drives each table row and asserts which counters
  move. A color or opacity edit moves no geometry or position counters.
- Mounting and unmounting a `<Structure>` with every representation N times
  returns the viewer-owned live GPU buffer count to its baseline. After a forced
  GC, no device buffer created during the cycles is still referenced. use.gpu
  0.20.0 drops some small per-draw buffers without calling destroy(); the
  browser frees them on GC, so they don't count as a leak.
- The selection cache stays bounded under churn.
- Any violation found becomes its own bug bead. It is not fixed silently inside
  the audit.

**X3 — Release.**

- CI runs `deno task fmt`, `deno task test`, `deno task typecheck`,
  `deno task check:hardening` and `deno task jsr:check`.
- Every package moves to `0.1.0` and gains a top-level `CHANGELOG.md`, managed
  by changesets or a documented manual procedure.
- `repository` (with `directory`) is added once a remote exists.
- `LICENSE` is present, and the upstream attribution for the Mol*-ported `geo`
  code is preserved.
- The docs and examples gallery link to each package README.
- A dry-run publish of the whole workspace succeeds in dependency order.
  Actually publishing to JSR is a separate human decision.

Status (2026-10-02): all packages are at `0.1.0` with a `CHANGELOG.md` (manual
procedure in [RELEASING.md](RELEASING.md)). `geo`, `io` and `table` carry the
Mol* MIT notice in `LICENSE`. The root [README](../README.md) and the examples
gallery link every package README. `.github/workflows/ci.yml` runs the Deno
gates; the [architecture gate](findings/2026-10-02-crj13-architecture-gate.md)
records passing hosted and local acceptance. Actual Deno manifests define the
publish contract; npm-era `types`/`import`, tarball and `repository` wording
above is historical where it does not match those manifests. Export discipline
R1/R3 was reconciled in `molgpu-sept-ktr.7`: useful shared aliases and concrete
inline props are accepted, with no public removals. A passing hardening script
does not prove every review judgement or browser composition.
