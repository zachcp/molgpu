# Releasing

The seven `@molgpu/*` packages are versioned and released together (lockstep):
every package carries the same version, and internal dependencies pin that
exact version. `@molgpu/table` is the exception on the consumer side: it is a
peer dependency (`^0.1.0`) of `select`, `fields`, `io` and `viewer`, because
structure identity is module-private and an app must hold a single copy.

Changelogs are kept by hand (no changesets). Each package has its own
`CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form.

## While developing

When a change is visible to users of a package, add a line under
`## [Unreleased]` in that package's `CHANGELOG.md` in the same commit.
Removing or changing anything marked *stable* in a README needs a note in the
changelog and a minor bump while we are on 0.x.

## Cutting a release

1. Pick the version. On 0.x, breaking changes bump the minor version and
   everything else bumps the patch.
2. Set `"version"` in every `packages/*/deno.json` to the new version and run
   `deno cache --reload --lock=deno.lock --lock-write deno.json` to refresh the lockfile.
3. In each `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
   and add a fresh empty `## [Unreleased]` above it. If a package has no changes,
   write "No changes; released in lockstep."
4. Run the gates:
   ```bash
   deno task test
   deno task typecheck
   deno task test:hardening
   deno task check:hardening
   deno task jsr:check
   ```
   Run the browser suites too (`deno task test:components`, `deno task test:examples`
   and the `deno task test:viewer:*` tasks). They need Chrome with WebGPU, so CI does not
   run them.
5. Commit, then tag `vX.Y.Z`.
6. Publish to JSR with `deno publish` from each package directory, in dependency
   order (`table`, `geo`, `timeline`, `select`, `fields`, `io`, `viewer`).

## Not yet done

- `repository` fields (with `directory`) get added once the repo has a remote.
- CI (`.github/workflows/ci.yml`) is written but hasn't run yet, because there
  is no remote.
