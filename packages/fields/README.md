# @molgpu/fields

Typed per-row value descriptions with one pure CPU evaluator and a renderer-free
WGSL code generator. A `Field<T, Domain>` assigns a value of type `T` — a colour,
a scalar (radius/opacity), or a label string — to every row of a domain (`atom`
or `residue`). Selections say *which* rows; fields say *what value* each gets.

One concept replaces MolViewSpec's `color` / `color_from_source` × categorical /
continuous × domain / overflow matrix.

## Constructors

- `constant(value)` — one value everywhere (number→scalar, `[r,g,b,a]`→colour, string→label).
- `attribute(name)` — read a numeric table column (`element`, `bfactor`, `occupancy`, `radius`, `residue`, `labelSeq`, `chain`) as a scalar on that column's domain.
- `categorical(input, cases, fallback)` — map an integer scalar input to per-category values, with an explicit fallback.
- `linear(input, { domain: [lo,hi], range?, overflow? })` — affine map into `range`; `overflow` is `clamp` (default), `wrap`, or `fail`.
- `colormap(input, stops)` — piecewise-linear colour gradient over a scalar input.
- `annotation(domain, type, values, { missing?, policy?, fallback? })` — externally supplied per-row values with an explicit missing policy (`fallback` or `fail`).
- `curve(stops, { overflow? })` — a scalar along the global parameter `t` (uniform, same for every row).

## Two evaluators, one definition

- `evaluate(field, data, { t?, domain? })` runs on the CPU and returns a packed
  `Float32Array` (numeric) or a `string[]` (labels/tooltips). Broadcast fields
  (`constant`, `curve`) need an explicit `{ domain }`.
- `compile(field, { target })` lowers a numeric field to
  `{ valueType, domain, target, entry, bindings, wgsl }`. Two targets: `raw`
  (default) emits `@group(0)` bindings and `fn evalField(row)`, runnable in a
  plain WebGPU compute pass; `link` emits `@link fn` accessors and `@export fn
  getField(row)` for the use.gpu shader linker (the viewer's `useField` binds the
  accessors to sources/uniforms in `bindings` order). `bindings` are plain data
  describing the inputs plus a pure `fill` function for each. **No `ShaderSource`
  crosses the package boundary** either way. String fields are CPU-only and
  `compile` rejects them; `linear` `overflow: 'fail'` is CPU-only too.

The CPU evaluator and the generated WGSL share numeric definitions and are proven
equal within tolerance by `npm run test:fields:gpu` (a raw-WebGPU compute pass, no
use.gpu). Node contract tests run under `npm test`.

## Built-ins and annotation joins

`byElement`, `byBfactor`, `bySeq`, and `byChain` are a small closed set of colour
presets composed from the primitives (no expression language); `columnRange(data,
name)` auto-ranges a domain from a column's min/max.

`joinAnnotation(data, records, options)` matches external per-residue or
per-chain records onto the table by an explicit identity policy — a chain field
plus residue discriminators, never a raw sequence number alone — and returns an
ordinary `annotation` field (lifted onto atoms by default). Missing rows follow
`policy` (`fallback`/`fail`); colliding keys follow `duplicate` (`error`/`first`/
`last`). The result composes like any other field, e.g. `colormap(linear(joined,
{ domain }), stops)`. The join is pure CPU work; the viewer's `useAnnotation`
adds fetching and loading state.
