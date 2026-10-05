# @molgpu/fields

Typed per-row value descriptions with one pure CPU evaluator and a renderer-free
WGSL code generator. A `Field` assigns a value — a colour, a scalar
(radius/opacity), or a label string — to every row of a domain (`atom` or
`residue`) of a `@molgpu/table` structure. Selections say _which_ rows; fields
say _what value_ each gets. Compose constructors to map numeric columns or
annotations into reusable styles.

## Install

```sh
deno add jsr:@molgpu/fields jsr:@molgpu/table
```

Keep all `@molgpu/*` packages on compatible versions so the application resolves
one shared `@molgpu/table`; see
[one shared table copy](https://jsr.io/@molgpu/table#one-shared-table-copy).

## Example

This example loads a BinaryCIF file with the optional `@molgpu/io` package
(`deno add jsr:@molgpu/io`) and evaluates colours without a GPU. Save it as
`fields.ts` and run `deno run --allow-net fields.ts`.

```ts
import { structureFromBcif } from "@molgpu/io";
import {
  attribute,
  byElement,
  colormap,
  columnRange,
  compile,
  constant,
  evaluate,
  linear,
} from "@molgpu/fields";

const data = await structureFromBcif("https://models.rcsb.org/1crn.bcif");
const heat = colormap(
  linear(attribute("bfactor"), {
    domain: columnRange(data, "bfactor"),
  }),
  [
    [0, [0, 0, 1, 1]],
    [1, [1, 0, 0, 1]],
  ],
);

console.log(evaluate(heat, data)); // packed RGBA, four floats per atom
console.log(evaluate(byElement(), data)); // element colours
console.log(evaluate(constant(1.5), data, { domain: "residue" }));
console.log(compile(heat).bindings.map((binding) => binding.id)); // ["attr:bfactor"]
```

If you already have a `StructureData`, start with a field constructor. In a
viewer scene, pass `heat` to a representation's `color` prop; see the
[viewer API](https://jsr.io/@molgpu/viewer#api) for supported field-valued
props.

## Constructors

- `constant(value)` — one value everywhere (number→scalar, `[r,g,b,a]`→colour,
  string→label).
- `attribute(name, { domain?, lift? })` — read a built-in, well-known or
  namespaced custom numeric column through `@molgpu/table`. Custom names require
  a domain. A built-in residue column lifts with `{ domain: "atom" }`; a custom
  residue column also needs `lift: true`.
- `categorical(input, cases, fallback)` — map an integer scalar input to
  per-category values, with an explicit fallback.
- `linear(input, { domain: [lo,hi], range?, overflow? })` — affine map into
  `range`; `overflow` is `clamp` (default), `wrap`, or `fail`. Both domain
  endpoints map to their corresponding range endpoints, including reversed
  domains. `wrap` repeats only outside the closed domain: for `[0,1]`, inputs
  `0` and `1` remain `0` and `1`, while `-0.25` and `1.25` become `0.75` and
  `0.25`.
- `colormap(input, stops)` — piecewise-linear colour gradient over a scalar
  input.
- `annotation(domain, type, values, { missing?, policy?, fallback? })` —
  externally supplied per-row values with an explicit missing policy (`fallback`
  or `fail`). Use the package-root `SCALAR` or `COLOR` descriptor as `type`.
  Evaluating or baking it for a structure whose row count differs fails.
- `curve(stops, { overflow? })` — a scalar along the global parameter `t`
  (uniform, same for every row). Curve `wrap` is periodic over the half-open
  stop interval: the last stop time wraps to the first stop value.

## Numeric input policy

Constructor parameters must be finite JavaScript numbers: scalar/color
constants, linear domain/range endpoints, category keys/values/fallbacks, and
curve/colormap stops. CPU calculations retain JavaScript precision; numeric
outputs are packed as `Float32Array`. Finite values outside f32 range can
therefore overflow CPU outputs.

WGSL compilation rounds literal parameters to f32, emits valid
decimal/scientific notation and preserves signed zero in literals. It rejects
parameters or derived spans that overflow f32, and interpolation intervals whose
endpoints or width collapse in f32. Very small values may round to signed zero;
representable subnormal literals are accepted. GPU arithmetic may flush
subnormal values to zero, as allowed by
[WGSL floating-point rules](https://www.w3.org/TR/WGSL/#floating-point-evaluation).
This policy also applies to baked coefficients in the volume WGSL generators. It
does not validate runtime attribute/annotation columns or guarantee finite
results for every arithmetic expression.

## Two evaluators, one definition

- `evaluate(field, data, { t?, domain?, volume? })` runs on the CPU and returns
  a packed `Float32Array` (numeric) or a `string[]` (labels/tooltips). Broadcast
  fields (`constant`, `curve`) need an explicit `{ domain }`.
- `compile(field, { target?, domain?, volume? })` lowers a numeric field to
  `{ valueType, domain, target, entry, bindings, wgsl }`. Two targets: `raw`
  (default) emits `@group(0)` bindings and `fn evalField(row)`, runnable in a
  plain WebGPU compute pass; `link` emits `@link fn` accessors and
  `@export fn
  getField(row)` for the use.gpu shader linker (the viewer's
  `useField` binds the accessors to sources/uniforms in `bindings` order).
  `bindings` are plain data describing the inputs plus a pure `fill` function
  for each. **No `ShaderSource` crosses the package boundary** either way — the
  WGSL is a string and the binding schema is plain data. String fields are
  CPU-only and `compile` rejects them; `linear` `overflow: 'fail'` is CPU-only
  too.

`volumeSample(volume)` samples an explicit scalar volume at atom coordinates.
`volumeSample()` uses the nearest viewer volume. For standalone CPU evaluation,
provide the samples with `evaluate(field, data, { volume })`; for compilation,
provide its grid with `compile(field, { volume })`.

CPU evaluation reads the coordinates and columns of the supplied structure at
call time. A field built from `joinAnnotation` contains the joined values from
that call; rebuild it when annotation records or the row layout change.

## Built-ins and annotation joins

`byElement`, `byBfactor`, `bySeq`, `byChain`, `byCharge` and
`bySecondaryStructure` are a small closed set of colour presets composed from
the primitives (no expression language); choose an explicit domain when
normalising a field over a selected range. `columnRange(data, name)` is
available from the package root when a preset needs a range derived from an
attribute column.

```js
import {
  byBfactor,
  byChain,
  bySecondaryStructure,
  bySeq,
} from "@molgpu/fields";

const temperature = byBfactor({ domain: [10, 40] });
const sequencePosition = bySeq({ domain: [0, 99] });
const chains = byChain();
const cartoonColor = bySecondaryStructure();
```

```ts
import { evaluate, joinAnnotation } from "@molgpu/fields";

// `data` is the structure loaded above. Match a score to author chain A, residue 2.
const scores = joinAnnotation(data, [{
  chainAuth: "A",
  authSeq: "2",
  value: 0.9,
}], {
  fields: ["chainAuth", "authSeq"],
});
console.log(evaluate(scores, data)); // 0.9 on matching atoms; 0 elsewhere
```

Include `model`, `insCode` or other identity fields when chain and sequence
alone do not distinguish the intended residues.

`joinAnnotation(data, records, options)` matches external per-residue or
per-chain records onto the table by an explicit identity policy — a chain field
plus residue discriminators, never a raw sequence number alone — and returns an
ordinary `annotation` field (lifted onto atoms by default; a `chain` join must
be lifted). Missing rows follow `policy` (`fallback`/`fail`); colliding keys
follow `duplicate` (`error`/`first`/`last`). The result composes like any other
field, e.g. `colormap(linear(joined, { domain }), stops)`. The join is pure CPU
work. The application owns fetching and loading state, then passes the joined
field to a viewer representation. No annotation-fetching hook is exported.

## API

_stable_: relied on by other packages and settled. _experimental_: may change in
0.x minor releases. _advanced_: for renderer integrations (the viewer), not app
code.

| Export                     | Stability    | Description                                                                                                   |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `Field`                    | stable       | Opaque typed per-row value description; build with the constructors.                                          |
| `Color`                    | stable       | `[r, g, b, a]` colour tuple, components in 0–1.                                                               |
| `Domain`                   | stable       | Row domain of a field: `'atom'` or `'residue'`.                                                               |
| `constant`                 | stable       | One value for every row (number, colour, or string).                                                          |
| `attribute`                | stable       | Read a numeric table column as a scalar field.                                                                |
| `categorical`              | stable       | Map an integer scalar to per-category values with a fallback.                                                 |
| `colormap`                 | stable       | Piecewise-linear colour gradient over a scalar input.                                                         |
| `volumeSample`             | experimental | Scalar value of a `VolumeData` at each atom's position (trilinear; 0 outside).                                |
| `sampleVolumeWgsl`         | experimental | WGSL `fn(p: vec3<f32>) -> f32` trilinear sampler for a volume, reading samples through a named accessor.      |
| `sampleVolumeGradientWgsl` | experimental | WGSL `fn(p) -> vec3<f32>` gradient of the trilinear sampler; zero near the grid boundary.                     |
| `readsNearestVolume`       | experimental | True when a field contains an argument-free `volumeSample()`.                                                 |
| `curve`                    | stable       | Scalar along the global timeline parameter `t`.                                                               |
| `evaluate`                 | stable       | CPU evaluation to a packed `Float32Array` or `string[]`.                                                      |
| `byElement`                | stable       | CPK colour-by-element preset.                                                                                 |
| `linear`                   | experimental | Affine map of a scalar input with clamp/wrap/fail overflow.                                                   |
| `annotation`               | experimental | Externally supplied per-row values with a missing policy.                                                     |
| `SCALAR`                   | experimental | Scalar `ValueType` descriptor accepted by `annotation`.                                                       |
| `COLOR`                    | experimental | Colour `ValueType` descriptor accepted by `annotation`.                                                       |
| `columnRange`              | experimental | Min/max range of a numeric table column for built-in field domains.                                           |
| `ValueType`                | experimental | Field value type descriptor (kind, components, WGSL type name).                                               |
| `byBfactor`                | experimental | B-factor on a cool-to-warm ramp.                                                                              |
| `bySeq`                    | experimental | Residue index on a rainbow ramp.                                                                              |
| `byChain`                  | experimental | Chain index from a cyclic palette.                                                                            |
| `byCharge`                 | experimental | Charge on Mol*'s red-white-blue scale over `[-1, 1]` e; `column` and `lift` read other charge columns.        |
| `byPotential`              | experimental | Electrostatic potential, red-white-blue over ±`range` (default 15), sampled from a volume or the nearest one. |
| `bySecondaryStructure`     | experimental | Residue `ssCode` on Mol*'s secondary-structure colours (helix types, strand, turn, bend, white coil).         |
| `joinAnnotation`           | experimental | Join external records onto the table by identity; returns an annotation field.                                |
| `IdentityField`            | experimental | Name of an identity field usable as a join key.                                                               |
| `ResidueIdentity`          | experimental | Full residue identity (model, chain ids, seq ids, insertion code, comp).                                      |
| `compile`                  | advanced     | Lower a numeric field to a WGSL string plus a plain-data binding schema.                                      |

## Integration

This package depends on [`@molgpu/table`](https://jsr.io/@molgpu/table). Its CPU
evaluator and WGSL generator require no renderer. Advanced integrations can
consume `compile`'s strings and binding descriptions;
[`@molgpu/viewer`](https://jsr.io/@molgpu/viewer) adapts them to use.gpu.
