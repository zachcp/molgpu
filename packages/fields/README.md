# @molgpu/fields

Typed per-row value descriptions with one pure CPU evaluator and a renderer-free
WGSL code generator. A `Field` assigns a value — a colour, a scalar
(radius/opacity), or a label string — to every row of a domain (`atom` or
`residue`) of a `@molgpu/table` structure. Selections say _which_ rows; fields
say _what value_ each gets. One concept replaces MolViewSpec's `color` /
`color_from_source` × categorical / continuous × domain / overflow matrix.

## Install

```sh
deno add jsr:@molgpu/fields jsr:@molgpu/table
```

Peer dependency: `@molgpu/table` (one shared copy per app, since structure
identity is module-private). The package never imports use.gpu or Mol*.

## Example

Runs in plain Node (no GPU):

```js
import { createStructure } from "@molgpu/table";
import {
  attribute,
  byElement,
  colormap,
  compile,
  constant,
  evaluate,
  joinAnnotation,
  linear,
} from "@molgpu/fields";

// Two residues (ALA 1, CYS 2) in chain A, four atoms: C N O S.
const data = createStructure({
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
  topology: {
    atoms: {
      count: 4,
      id: ["1", "2", "3", "4"],
      name: ["C", "N", "O", "S"],
      altloc: ["", "", "", ""],
      residue: Uint32Array.of(0, 0, 1, 1),
      element: Uint8Array.of(6, 7, 8, 16),
      occupancy: Float32Array.of(1, 1, 1, 1),
      bfactor: Float32Array.of(10, 20, 30, 40),
      radius: Float32Array.of(1.7, 1.55, 1.52, 1.8),
    },
    residues: {
      count: 2,
      chain: Uint32Array.of(0, 0),
      labelSeq: Int32Array.of(1, 2),
      authSeq: ["1", "2"],
      insertionCode: ["", ""],
      comp: ["ALA", "CYS"],
      polymer: ["protein", "protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.of(1),
      labelId: ["A"],
      authId: ["A"],
    },
    bonds: {
      count: 0,
      a: new Uint32Array(),
      b: new Uint32Array(),
      order: new Uint8Array(),
      source: [],
    },
    instances: {
      count: 1,
      chain: Uint32Array.of(0),
      operatorId: ["1"],
      transform: Float64Array.of(
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      ),
    },
  },
});

// Colour atoms by B-factor: normalise [10, 40] to [0, 1], then sample a gradient.
const heat = colormap(linear(attribute("bfactor"), { domain: [10, 40] }), [
  [0, [0, 0, 1, 1]],
  [1, [1, 0, 0, 1]],
]);
console.log(evaluate(heat, data)); // Float32Array(16): blue ... red
console.log(evaluate(byElement(), data).length); // 16 (4 atoms x RGBA)
console.log(evaluate(constant(1.5), data, { domain: "residue" })); // Float32Array [1.5, 1.5]

// Join per-residue scores by identity (chain + sequence), lifted onto atoms.
const scores = joinAnnotation(data, [{
  chainAuth: "A",
  authSeq: "2",
  value: 0.9,
}], {
  fields: ["chainAuth", "authSeq"],
});
console.log(evaluate(scores, data)); // Float32Array [0, 0, 0.9, 0.9]

// Lower a numeric field to WGSL plus plain-data bindings (no GPU needed here).
console.log(compile(heat).bindings.map((b) => b.id)); // ['attr:bfactor']
```

In an app you would pass `heat` as the `color` of a `@molgpu/viewer`
representation rather than evaluating it yourself.

## Constructors

- `constant(value)` — one value everywhere (number→scalar, `[r,g,b,a]`→colour,
  string→label).
- `attribute(name, { domain? })` — read a built-in, well-known or namespaced
  custom numeric column through `@molgpu/table`. Custom names require a domain.
  A residue column can be lifted to atoms with `{ domain: "atom" }`.
- `categorical(input, cases, fallback)` — map an integer scalar input to
  per-category values, with an explicit fallback.
- `linear(input, { domain: [lo,hi], range?, overflow? })` — affine map into
  `range`; `overflow` is `clamp` (default), `wrap`, or `fail`.
- `colormap(input, stops)` — piecewise-linear colour gradient over a scalar
  input.
- `annotation(domain, type, values, { missing?, policy?, fallback? })` —
  externally supplied per-row values with an explicit missing policy (`fallback`
  or `fail`).
- `curve(stops, { overflow? })` — a scalar along the global parameter `t`
  (uniform, same for every row).

## Two evaluators, one definition

- `evaluate(field, data, { t?, domain? })` runs on the CPU and returns a packed
  `Float32Array` (numeric) or a `string[]` (labels/tooltips). Broadcast fields
  (`constant`, `curve`) need an explicit `{ domain }`.
- `compile(field, { target })` lowers a numeric field to
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

The CPU evaluator and the generated WGSL share numeric definitions and are
proven equal within tolerance by `deno task test:fields:gpu` (a raw-WebGPU
compute pass, no use.gpu). Type-checked contract tests run under
`deno task test`.

## Built-ins and annotation joins

`byElement`, `byBfactor`, `bySeq`, `byChain` and `byCharge` are a small closed
set of colour presets composed from the primitives (no expression language);
`columnRange(data,
name)` auto-ranges a domain from a column's min/max.

`joinAnnotation(data, records, options)` matches external per-residue or
per-chain records onto the table by an explicit identity policy — a chain field
plus residue discriminators, never a raw sequence number alone — and returns an
ordinary `annotation` field (lifted onto atoms by default; a `chain` join must
be lifted). Missing rows follow `policy` (`fallback`/`fail`); colliding keys
follow `duplicate` (`error`/`first`/`last`). The result composes like any other
field, e.g. `colormap(linear(joined, { domain }), stops)`. The join is pure CPU
work; the viewer's `useAnnotation` adds fetching and loading state.

## API

_stable_: relied on by other packages and settled. _experimental_: may change
before 0.1.0. _advanced_: for renderer integrations (the viewer), not app code.

| Export                 | Stability    | Description                                                                                              |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `Field`                | stable       | Opaque typed per-row value description; build with the constructors.                                     |
| `Color`                | stable       | `[r, g, b, a]` colour tuple, components in 0–1.                                                          |
| `Domain`               | stable       | Row domain of a field: `'atom'` or `'residue'`.                                                          |
| `constant`             | stable       | One value for every row (number, colour, or string).                                                     |
| `attribute`            | stable       | Read a numeric table column as a scalar field.                                                           |
| `categorical`          | stable       | Map an integer scalar to per-category values with a fallback.                                            |
| `colormap`             | stable       | Piecewise-linear colour gradient over a scalar input.                                                    |
| `volumeSample`         | experimental | Scalar value of a `VolumeData` at each atom's position (trilinear; 0 outside).                           |
| `sampleVolumeWgsl`     | experimental | WGSL `fn(p: vec3<f32>) -> f32` trilinear sampler for a volume, reading samples through a named accessor. |
| `curve`                | stable       | Scalar along the global timeline parameter `t`.                                                          |
| `evaluate`             | stable       | CPU evaluation to a packed `Float32Array` or `string[]`.                                                 |
| `byElement`            | stable       | CPK colour-by-element preset.                                                                            |
| `linear`               | experimental | Affine map of a scalar input with clamp/wrap/fail overflow.                                              |
| `annotation`           | experimental | Externally supplied per-row values with a missing policy.                                                |
| `Overflow`             | experimental | `linear` overflow mode: `'clamp' \| 'wrap' \| 'fail'`.                                                   |
| `Scalar`               | experimental | Alias for `number` as a field value.                                                                     |
| `ValueType`            | experimental | Field value type descriptor (kind, components, WGSL type name).                                          |
| `SCALAR`               | experimental | Scalar value type (for `annotation` / `JoinOptions.type`).                                               |
| `COLOR`                | experimental | Colour value type (for `annotation` / `JoinOptions.type`).                                               |
| `STRING`               | experimental | String value type (CPU-only fields).                                                                     |
| `EvalContext`          | experimental | `evaluate` options: timeline `t` and broadcast `domain`.                                                 |
| `byBfactor`            | experimental | B-factor on a cool-to-warm ramp.                                                                         |
| `bySeq`                | experimental | Residue index on a rainbow ramp.                                                                         |
| `byChain`              | experimental | Chain index from a cyclic palette.                                                                       |
| `byCharge`             | experimental | Charge on Mol*'s red-white-blue scale over `[-1, 1]` e; `column` and `lift` read other charge columns.   |
| `bySecondaryStructure` | experimental | Residue `ssCode` on Mol*'s secondary-structure colours (helix types, strand, turn, bend, white coil).    |
| `columnRange`          | experimental | Min/max of a column, for auto-ranging a domain.                                                          |
| `joinAnnotation`       | experimental | Join external records onto the table by identity; returns an annotation field.                           |
| `JoinOptions`          | experimental | Options for `joinAnnotation` (identity fields, value, policies, lift).                                   |
| `IdentityField`        | experimental | Name of an identity field usable as a join key.                                                          |
| `ResidueIdentity`      | experimental | Full residue identity (model, chain ids, seq ids, insertion code, comp).                                 |
| `ChainIdentity`        | experimental | Chain identity (model, label and auth chain ids).                                                        |
| `residueIdentity`      | experimental | Read a residue row's identity from a structure.                                                          |
| `chainIdentity`        | experimental | Read a chain row's identity from a structure.                                                            |
| `compile`              | advanced     | Lower a numeric field to a WGSL string plus a plain-data binding schema.                                 |
| `Compiled`             | advanced     | Result of `compile`: value type, domain, entry, bindings, WGSL.                                          |
| `Binding`              | advanced     | One GPU input of a compiled field, with a pure `fill` function.                                          |
| `Target`               | advanced     | `compile` target: `'raw'` (plain WebGPU) or `'link'` (use.gpu linker).                                   |

## Place in the dependency graph

```
table ──► fields ──► viewer
```

`@molgpu/fields` depends only on `@molgpu/table` and is consumed by
`@molgpu/viewer` (which lowers compiled fields to use.gpu sources in `useField`,
and wraps `joinAnnotation` in `useAnnotation`).

It must not import `molstar` (only `@molgpu/io` may), any `@use-gpu/*` package
(GPU lowering and use.gpu types live in `@molgpu/viewer`), or any other
`@molgpu/*` package besides `table`. Its public types never mention use.gpu or
Mol*; `compile` returns WGSL as a plain string, never a `ShaderSource`.
