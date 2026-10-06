# Releasing

The eight `@molgpu/*` packages are versioned and released together (lockstep).
Internal dependencies publish as caret JSR ranges of the same release, which
resolve one copy when compatible (see the table README's
[one shared table copy](../packages/table/README.md#one-shared-table-copy)).
Keep the application on compatible table and timeline versions: their
module-private identity/curve state rejects values from divergent copies. Match
use.gpu's reviewed exact `0.20.0` npm dependencies in the application. IO
publishes the tested Mol* version exactly (`5.13.0`).

Changelogs are kept by hand (no changesets). Each package has its own
`CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form.

## While developing

When a change is visible to users of a package, add a line under
`## [Unreleased]` in that package's `CHANGELOG.md` in the same commit. Removing
or changing anything marked _stable_ in a README needs a note in the changelog
and a minor bump while we are on 0.x.

## Cutting a release

1. Merge user-facing changes using Conventional Commit prefixes (`feat:`,
   `fix:`, `perf:`, and so on). The separate `Release Please` workflow opens a
   release PR, updates all eight package versions in lockstep, and creates the
   `vX.Y.Z` release tag when that PR is merged. On 0.x, breaking changes bump
   the minor version and everything else bumps the patch.
2. For automated releases, configure the repository secret
   `RELEASE_PLEASE_TOKEN` with a token that can write contents and pull
   requests. A token is used instead of the default `GITHUB_TOKEN` so the tag
   created by release-please can trigger the tag-based JSR publication workflow.
3. During the release PR, review the lockstep version changes in every
   `packages/*/deno.json`; after merging, run
   `deno cache --reload --lock=deno.lock --lock-write deno.json` if the lockfile
   needs refreshing.
4. In each `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
   and add a fresh empty `## [Unreleased]` above it. If a package has no
   changes, write "No changes; released in lockstep."
5. Run the gates:
   ```bash
   deno task fmt
   deno task test
   deno task typecheck
   deno task check:hardening
   deno task jsr:check
   ```
   Run the browser suites too (`deno task test:components`,
   `deno task test:site` and the `deno task test:viewer:*` tasks). They need
   Chrome with WebGPU. The CI workflow runs selected browser suites in five
   groups; see `scripts/run-webgpu-ci.sh` for the current list. The tag-based
   Publish workflow runs the Deno checks above, so inspect browser CI before
   merging a release PR.
6. Release Please commits and tags the release after its PR is merged. The
   `Publish` GitHub Actions workflow runs the same quality gates and then
   publishes the root Deno workspace to JSR with `deno publish`. Deno resolves
   workspace package dependencies and publishes the eight packages in the
   required order. The generated `vX.Y.Z` tag is the explicit action that starts
   publishing.

The GitHub repository must be linked to every `@molgpu/*` package in JSR
settings before the first workflow publish. GitHub Actions uses the JSR OIDC
integration (`id-token: write`); no long-lived publish token is stored in GitHub
secrets. Repository links are configured in JSR rather than in `package.json`:
this repository has no npm package manifests, and JSR package configuration
lives in each package's `deno.json`.

## Registry and workflow setup

The scope and all eight packages already have a published `0.1.0` release. For a
new registry setup or changes to automation:

- Create any missing packages in the `@molgpu` scope, then link each package to
  `zachcp/molgpu` in its JSR settings. Linking is an account-level setup step
  that cannot be completed by this repository's CI configuration.
- Push the repository to its `origin` remote so GitHub Actions can run CI. The
  remote URL is `https://github.com/zachcp/molgpu`.
- After publishing a release, verify Node/Vite consumption through JSR's npm
  compatibility endpoint (`npx jsr add @molgpu/viewer`). The npm compatibility
  path depends on the package having been published first.
