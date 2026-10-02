# Native dispatch observation

Tracking: `molgpu-sept-ktr.8`. Reviewed installed use.gpu `0.20.0`:
`compute/kernel.mjs`, `queue/dispatch.mjs`, `pass/compute-pass.mjs` and
`hooks/useInitialDispatch.mjs`.

`Kernel` returns no compute call until the asynchronous pipeline is ready. Its
initial guard can suppress a yielded call. The dispatch count callback fires
inside the actual compute path, but the upstream API supplies no callback with
the submitted molecular generation. `ComputePass` submits synchronously after
all compute callbacks return.

The private `useDispatchObservation` hook gathers one Kernel, wraps its native
compute call, forwards dispatch counts and deduplicates notifications by local
revision. It schedules publication in a mounted-guarded microtask after a
successful encoded call. That establishes submission order, not GPU completion.
Readback completion still requires the consumer's queue/readback protocol.

CoordinateKernel and AttributeProducer retain their own generation, readiness,
context publication and buffer ownership. FieldLines retains geometry versions,
dispatch instrumentation and draw/style policy through its synchronous
`onEncoded` callback. No raw compute path or public resource framework is added.

Acceptance uses the trajectory, electric-field, invalidation and retirement
browser suites, including held pipelines, same-buffer revisions, replacement,
unmount, FieldLines style edits and uncaptured WebGPU errors. Fresh retirement
outputs are retained under `/tmp/molgpu-ktr8-evidence`; existing checked-in
evidence edits are restored byte for byte by the validation wrapper.
