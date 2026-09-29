# Immutable Attribute Retention, Gate 2

Date: 2026-09-29. Implementation evidence for `molgpu-sept-19s` on the reviewed
use.gpu 0.20.0 pin.

An immutable attribute upload is owned by a mounted `Structure` for one
topology/attribute layout revision and device. Coordinate revisions and style
changes borrow the same source. A replacement `Structure` can reuse the source
during a 100 ms cache window, after which the cache drops its reference. This
window is only for reuse; it is **not** a GPU completion signal and never calls
`GPUBuffer.destroy()`. A retained use.gpu draw may still hold the old source.

Gate 2 starts with `element` colour and changes to `bfactor`. The four-atom
fixture requests one 16-byte `bfactor` buffer and one upload on first demand.
Repeated palette changes request no more attribute or geometry buffers and write
no coordinate, endpoint or segment rows. A second browser page holds replacement
render compilation, advances frames, unmounts the Structure, then releases
compilation; it observes no attribute destruction and no uncaptured WebGPU
error. The full invalidation browser audit also checks coordinate replacement,
five mount/unmount cycles of every representation, and selection churn.

The retention probe uses 64 sequential synthetic owner tokens, a shared
immutable 50,000-row `f32` column and one device. Each owner borrows the same
source twice. The reuse budget is **one 200,000-byte GPUBuffer request across
the rapid churn**. It then churns 64 distinct 50,000-row columns, requesting
12.8 MB in total. After the 100 ms reuse window and forced GC, at most one of
those 64 distinct JS `GPUBuffer` wrappers may remain reachable from the probe's
current stack. The test asserts these limits. These are requested buffer sizes
and JS wrapper counts, not measured native GPU memory. WebGPU does not expose
native allocation or reclamation timing, so this probe cannot establish a native
peak. Broader native retention under dynamic owner, buffer and provider
replacement remains `molgpu-sept-crj.15` work.

`deno task test:viewer:gate2` is included again in WebGPU CI. A passing local
run does not by itself establish that the hosted CI environment passes.
