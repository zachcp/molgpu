# Fresh retirement acceptance evidence

Date: 2026-10-11. Tracking: `molgpu-sept-qlv`. Source baseline:
`f202603a04109cb8b48e3ef8205d76da3324a2e3` plus the local harness changes
recorded here. The worktree is dirty; each artifact records its own source
status. The earlier `8ej` report edit and unrelated untracked `.claude/` were
already present before this work.

The maintained retirement wrapper and all six standalone evidence writers now
use fresh temporary directories by default. The wrapper prints the absolute
location and passes it to all eleven child invocations. An explicit
`--output-dir=...` argument overrides `MOLGPU_RETIREMENT_OUTPUT_DIR`; standalone
children honor the same routing. Scenario filenames include their options, so
passes and passes/same-size produce separate artifacts. Existing artifacts and
logs are reserved with `createNew` and cannot be silently overwritten.

A small test-only evidence helper records UTC timestamps, source commit and
dirty status, installed use.gpu package versions, scenario/options, browser and
adapter metadata, original report payloads, and running/passed/failed outcome.
Missing metadata is explicit. A failed assertion retains the report already
collected and its error stack; child stdout/stderr logs survive a nonzero exit,
which fails the wrapper. The evidence envelope is finalized only after the
unchanged assertions and cleanup succeed. Adapter metadata is a separate
`requestAdapter` probe in the page's secure context, not a GPU completion
observation.

No production allocation, lifetime, dispatch, held-resource probe or acceptance
assertion changed. Browser frame waits and existing scientific tolerances were
preserved. CI selects an explicit temporary artifact directory for the
retirement group and uploads it on success or failure. HARDENING documents
routing and provenance. Historical evidence retains its original contents and
meaning.

## Verification commands

```sh
deno test -A test/hardening/retirement-evidence.test.ts
deno test -A packages/viewer/test/run-retirement.mjs
deno test -A packages/viewer/test/run-retirement.mjs
```

The focused tests cover distinct default destinations, argument/environment
precedence, scenario separation, collision refusal, provenance, failed-report
retention and nonzero child failure with retained stdout/stderr. Full browser
runs use the approved socket-capable environment because the sandbox cannot bind
Vite's local listening sockets.

## Results

Both complete wrappers passed all eleven child cases with no uncaptured WebGPU
errors: the first took 3m6s, the second 2m51s. Each wrapper is one Deno test
(`1 passed, 0 failed`); its eleven subprocess cases must not be counted as
eleven Deno tests. The distinct default destinations are:

- `/var/folders/5m/nnqc8qr11hbglqw0j763vtv80000gn/T/molgpu-retirement-17c9b65bdd4a58ab`
- `/var/folders/5m/nnqc8qr11hbglqw0j763vtv80000gn/T/molgpu-retirement-a8c0c0f03f01fe85`

Each directory contains eleven JSON artifacts with `outcome: passed` and 22
stdout/stderr logs. All JSON artifacts were inspected for non-null original
reports, valid UTC timestamps, the exact baseline commit, dirty state, browser,
adapter and all twelve installed use.gpu versions. Each installed package has
one version, `0.21.0-rc.2`; Live and Frame also resolve directly to that exact
installed version through `import.meta.resolve`. Environment: Deno 2.9.7,
`aarch64-apple-darwin`, headless Chrome `154.0.8037.98`, default
`--enable-unsafe-webgpu`; adapter probe vendor `apple`, architecture `metal-3`,
non-fallback. Device and description are empty, so the specific GPU model is
unavailable.

The explicit standalone check also passed:

```sh
deno run -A test/spikes/gpu-retirement/run-status.mjs --output-dir=/private/tmp/molgpu-qlv-standalone.QQzdiB
```

Its `status-retirement.json` is in that destination and records a passed
outcome. The focused routing/provenance/failure tests passed
(`2 passed, 0 failed`). Scoped formatting (12 files), lint (9 files), and
`git diff --check` passed. The workflow artifact upload is configured; hosted
execution was not part of this local gate. No public API or production source
changed, so package hardening/JSR dry-run and scientific unit suites were not
repeated.

Retained logs are `/private/tmp/molgpu-qlv-run1.log`,
`/private/tmp/molgpu-qlv-run2.log` and `/private/tmp/molgpu-qlv-standalone.log`.
An artifact inspection script is retained at `/private/tmp/qlv-inspect.mjs`.
Before/after SHA-256 inventories of every tracked `docs/findings/evidence` file
are `/private/tmp/molgpu-qlv-evidence-before.sha256` and
`/private/tmp/molgpu-qlv-evidence-after.sha256`; they compare identically. Git
status contains only the intended harness, CI, documentation and focused-test
changes plus the previously present report edit and `.claude/`. Historical
evidence was not modified. No publication or deployment was performed.
