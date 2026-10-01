# CI timeout and browser suite duration

PR #42's pull-request run 36862075895 failed at the charge demo's
`page.screenshot` call after 30 seconds. Fonts had loaded; Chrome's compositor
capture did not return. This was an operation timeout, not the 15-minute suite
limit or 60-minute job limit. The same commit's push run 36862068290 passed the
site and complete WebGPU suite, including the expanded retirement acceptance.

The site test now reads the rendered canvas as a PNG with `toDataURL` and keeps
the positive lit-pixel assertion and canvas size/interaction checks. This avoids
page compositor capture; it does not raise the timeout or retry failed scenes.
All maintained routes passed locally in 16 seconds. Hosted software-GPU
validation is required for the changed capture path.

## Keep complete coverage and shorten the critical path

The successful hosted run measured approximately 151 seconds for EField, 171
seconds for invalidation and 175 seconds for retirement. These are substantial
serial costs; the retirement coverage really added work. CI now places site,
EField (plus fields), invalidation, retirement and the other viewer suites on
five separate runners. Suites remain serial within a runner, avoiding
competition between browsers and preserving dedicated-process memory
measurements.

The selector in `scripts/run-webgpu-ci.sh` discovers every current browser suite
and assigns new viewer suites to the viewer group. List-mode validation confirms
all 21 current suites are assigned exactly once. Every suite retains a 15-minute
limit; all groups run even if one fails. The final `webgpu` check requires all
five groups to succeed, preserving the existing check name. Per-suite seconds
and exit codes appear in each job's summary, including timeout exit code 124.

CI runs on pull requests and pushes to main. Feature branches receive validation
when they have a PR; this removes the duplicate push/PR runs for each revision.
New revisions cancel superseded runs. Parallel jobs add runner setup overhead
and require available runner slots; the measured wall-time improvement must be
confirmed after the first matrix run.

## Options for further growth

- Keep complete PR coverage and rebalance groups using the recorded timings.
  This is the default implemented here.
- Reduce expensive fixture workloads only when the same correctness/retention
  boundaries remain covered. Small interactive tests and large memory acceptance
  cases serve different purposes; shrinking both would weaken the gate.
- Move broad stress sweeps to main or a scheduled job while retaining bounded
  lifetime and memory regressions on PRs. This reduces PR cost but delays
  discovery of failures unique to the larger sweep. Not implemented.
- Use hardware GPU runners for throughput-sensitive tests. This changes the
  environment and operating cost, and should retain a software-GPU compatibility
  lane. Not implemented.
- Raise a timeout only when measurements show a valid operation exceeds its
  budget. Increasing the job limit would not fix this compositor-capture
  failure.
