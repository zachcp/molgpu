# Field numeric inputs and WGSL literals

Date: 2026-10-02. Tracking: `molgpu-sept-ktr.16`. Source baseline: `d6a7286`.

## Reproduction and decision

Before implementation, new constructor and compile tests failed on nonfinite
scalar constants, overflowing literals and collapsed affine spans. The real
Chrome WGSL compiler rejected the emitted `1e+21.0` with
`expected ';' for return
statement`. These reproduce the October 2 review's
literal findings.

Require finite JavaScript constructor parameters, including scalar/color values,
linear domain/range endpoints and categorical keys. Existing finite stop and
fallback validation remains. Missing tuple entries also reject rather than
bypassing sparse-array validation. CPU calculations retain JavaScript precision;
packed numeric outputs can still overflow their Float32Array storage.

At WGSL emission, round literals with Math.fround and reject nonfinite results.
Keep valid exponent notation and explicitly emit `-0.0` for negative zero.
Underflow to signed zero is allowed. Interpolation denominators reject f32
widths of zero, collapsed endpoints and overflow. Linear, curve and colormap
compilation use that check. Attribute/annotation data and runtime expression
results are outside this authored-parameter validation contract.

One private serializer now serves primitive fields and volume generators,
replacing their two literal implementations without new public entries,
dependencies or renderer imports. Volume coefficient rounding remains f32;
nonfinite/overflowing coefficients now fail before producing invalid WGSL.

Signed-zero text and CPU outputs are checked separately. A GPU check requiring
the sign bit to remain negative failed on Chrome; numeric parity now permits
either zero sign, consistent with the explicit
[WGSL floating-point rules](https://www.w3.org/TR/WGSL/#floating-point-evaluation).
Nonzero literal outputs are checked exactly against their f32 CPU reference.
Subnormal constants compiled and matched on this browser; general GPU arithmetic
may flush subnormals, so the README does not promise portable bitwise
arithmetic.

## Verification

Passing checks:

- `deno test -A packages/fields/test/*.test.ts`: 39 type-checked tests.
- `deno check packages/fields/src/index.ts`.
- `deno task test:fields:gpu`: 39 cases in Chrome 154.0.8037.95, no page or
  uncaptured WebGPU errors. Twelve new literal cases cover both zero signs,
  positive/negative small and large exponents, minimum normal/subnormal f32,
  maximum positive/negative finite f32, and underflow to zero. Other tests cover
  rejection of overflow and collapsed linear/curve/colormap intervals.
- `deno task check:hardening`: all eight packages, unchanged API snapshots.
- `deno task jsr:check`: dry run only.
- Scoped formatting/lint and `git diff --check`.

The README and changelog record the input and lowering policy. No full viewer
GPU gate, benchmark, publication or deployment is claimed. Implementation
remains in the working tree.
