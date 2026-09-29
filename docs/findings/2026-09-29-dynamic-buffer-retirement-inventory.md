# Dynamic GPU Buffer Retirement Inventory

Date: 2026-09-29. `molgpu-sept-crj.15` implementation evidence on use.gpu
0.20.0, after `19s` landed. This is a per-path inventory and a bounded repair;
the issue remains open until the other published paths and memory cases pass.

| Owner / allocation                                     | Current cleanup                                             | Last possible consumer                        | State                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immutable Structure attribute                          | Owner releases references                                   | Retained styled draw                          | Fixed by `19s`; Gate 2 and CI pass.                                                                                                                |
| Shared `VolumeData` values                             | Last viewer borrower released references                    | Retained slice/field draw                     | Fixed here; held field style change reproduced 9 submissions after destruction and 9 WebGPU errors before the repair, then 0/0.                    |
| Root positions/radii (`ColumnSource`)                  | Immediate `destroy()`                                       | Retained representation draw                  | Open; needs held replacement coverage.                                                                                                             |
| Coordinate and GPU attribute `ComputeBuffer` output    | Immediate `destroy()`                                       | Retained draw and downstream compute/readback | Open; a held Transform all-to-selected replacement withdrew the old draw before destruction (0/0), which does not establish all provider variants. |
| Trajectory window/map, Transform and NormalMode inputs | Immediate `destroy()`                                       | Retained compute and downstream draw          | Open.                                                                                                                                              |
| Superpose/Unwrap working and status buffers            | Immediate `destroy()`                                       | Dispatch and status copy                      | Open.                                                                                                                                              |
| EField working/output buffers                          | Viewer releases references; native reachability reclaims   | Retained VolumeSlice draw or dispatch         | Fixed in the follow-up: resize with a held replacement produced 7 destroyed-phi submissions/errors before repair and 0/0 after.                   |
| FieldLines working/output buffers                      | Two-frame-plus-fence `retireBuffers()`                      | Retained draw or dispatch                     | Open; queue completion does not withdraw future retained work.                                                                                     |
| Coordinate bounds and status/snapshot readback staging | Immediate or map-completion `destroy()`                     | In-flight or later retained copy/map          | Open; preserve owner, buffer and layout tokens when changing cleanup.                                                                              |
| DSSP published `ssCode`                                | Immediate `destroy()`                                       | Retained field draw/readback                  | Open.                                                                                                                                              |
| DSSP transient scratch                                 | Destroyed in `gpuDssp()` after its awaited mapped readbacks | That invocation's submitted dispatch/copies   | Source-reviewed as local scratch; leave in place pending the held-compute run.                                                                     |

The [retirement probe](../../test/spikes/gpu-retirement/run.mjs) now has a
`--volume` policy. It holds replacement render compilation past two frames and a
completed queue fence. On the reviewed baseline, the old `volumeSample` draw
submitted a destroyed `molgpu:volume:values` buffer nine times and Chrome
reported nine uncaptured WebGPU errors. After removing only the volume source's
explicit destruction, `--volume --acceptance` records zero such submissions and
errors, while still observing the old draw after the fence and none after hiding
the subtree. `deno test -A packages/viewer/test/run-volume.mjs` passes with the
shared-copy, rendering and unmount checks.

The volume browser suite also mounts and unmounts a 256³ scalar map four times.
Each mount requests one 67,108,864-byte buffer; viewer ownership returns to zero
and the observed GPUBuffer wrapper is unreachable after forced GC. On Chrome
153.0.8010.53 for macOS, dedicated browser-process-tree RSS after each unmount
was 968,432, 966,352, 963,328 and 932,320 KiB. The executable bound rejects
growth greater than 128 MiB from the first to fourth unmount. RSS includes
browser, renderer and GPU processes and does not isolate native GPU memory; JS
wrapper reachability is reported separately. The hosted WebGPU run will
determine whether the same bound holds on SwiftShader.

The `--dynamic` policy held a Transform all-to-selected replacement. That
particular branch withdrew the old draw before the coordinate output was
destroyed, so it produced no post-destruction submission or WebGPU error. This
negative result is not a reason to keep immediate destruction for every
coordinate or attribute producer path; the remaining owner and consumer variants
above require their own coverage.

The `--efield` policy keeps a `VolumeSlice` drawing EField's live `phi` buffer,
resizes EField's grid, and holds replacement render compilation past two frames
and a completed queue fence. With `retireBuffers()`, the old slice submitted the
destroyed `phi` buffer seven times and Chrome reported seven uncaptured WebGPU
errors. Releasing EField's viewer ownership without explicit destruction
produced zero post-destroy submissions and errors; the old draw remained active
after the fence and stopped after the subtree was hidden. This trace covers
resize with a live slice, not all EField consumers. Its forced-GC observation
found no reachable molecular buffer wrappers, but native GPU memory still needs
repeat-churn coverage.
