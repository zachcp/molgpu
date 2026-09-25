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
2. Set `"version"` in every `packages/*/package.json`, plus every internal
   `@molgpu/*` dependency and the `@molgpu/table` peer range, to the new version.
   Run `npm install` to refresh the lockfile.
3. In each `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
   and add a fresh empty `## [Unreleased]` above it. If a package has no changes,
   write "No changes; released in lockstep."
4. Run the gates:
   ```bash
   npm test
   npm run test:hardening
   npm run check:hardening
   npm run release:dry-run
   ```
   Run the browser suites too (`npm run test:components`, `npm run test:examples`
   and the `test:viewer:*` scripts). They need Chrome with WebGPU, so CI does not
   run them.
5. Commit, then tag `vX.Y.Z`.
6. Publishing to npm is a separate, human decision. When it is made, publish
   in the order `scripts/publish-dry-run.mjs` uses (`table`, `geo`, `timeline`,
   `select`, `fields`, `io`, `viewer`), so each package's dependencies are
   already on the registry:
   ```bash
   npm publish --access public --workspace packages/<name>
   ```

## Not yet done

- `repository` fields (with `directory`) get added once the repo has a remote.
- CI (`.github/workflows/ci.yml`) is written but hasn't run yet, because there
  is no remote.
