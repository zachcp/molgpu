# Releasing

The seven `@molgpu/*` packages are versioned and released together (lockstep):
every package carries the same version, and internal dependencies pin that exact
version. `@molgpu/table` is the exception on the consumer side: it is a peer
dependency (`^0.1.0`) of `select`, `fields`, `io` and `viewer`, because
structure identity is module-private and an app must hold a single copy.

Changelogs are kept by hand (no changesets). Each package has its own
`CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form.

## While developing

When a change is visible to users of a package, add a line under
`## [Unreleased]` in that package's `CHANGELOG.md` in the same commit. Removing
or changing anything marked _stable_ in a README needs a note in the changelog
and a minor bump while we are on 0.x.

## Cutting a release

1. Pick the version. On 0.x, breaking changes bump the minor version and
   everything else bumps the patch.
2. Set `"version"` in every `packages/*/deno.json` to the new version and run
   `deno cache --reload --lock=deno.lock --lock-write deno.json` to refresh the
   lockfile.
3. In each `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
   and add a fresh empty `## [Unreleased]` above it. If a package has no
   changes, write "No changes; released in lockstep."
4. Run the gates:
   ```bash
   deno task fmt
   deno task test
   deno task typecheck
   deno task check:hardening
   deno task jsr:check
   ```
   Run the browser suites too (`deno task test:components`,
   `deno task test:site` and the `deno task test:viewer:*` tasks). They need
   Chrome with WebGPU, so CI does not run them.
5. Commit and push the release commit, then create and push the `vX.Y.Z` tag.
   The `Publish` GitHub Actions workflow runs the same quality gates and then
   publishes the root Deno workspace to JSR with `deno publish`. Deno resolves
   workspace package dependencies and publishes the seven packages in the
   required order. A tag push is the explicit action that starts publishing.

The GitHub repository must be linked to every `@molgpu/*` package in JSR
settings before the first workflow publish. GitHub Actions uses the JSR OIDC
integration (`id-token: write`); no long-lived publish token is stored in GitHub
secrets. Repository links are configured in JSR rather than in `package.json`:
this repository has no npm package manifests, and JSR package configuration
lives in each package's `deno.json`.

## First release setup

- Create the `@molgpu` scope and packages on jsr.io, then link each package to
  `zachcp/molgpu` in its JSR settings. Linking is an account-level setup step
  that cannot be completed by this repository's CI configuration.
- Push the repository to its `origin` remote so GitHub Actions can run CI. The
  remote URL is `https://github.com/zachcp/molgpu`.
- After the first release tag is pushed, verify Node/Vite consumption through
  JSR's npm compatibility endpoint (`npx jsr add @molgpu/viewer`). The npm
  compatibility path depends on the package having been published first.
