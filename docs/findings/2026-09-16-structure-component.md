# Structure component — ergonomics of the data intermediary

Spike: `spikes/examples/lib/` + `?ex=structure`. Verified rendering.
Question: what should `<Structure>` be, so representations never touch `RawData`?

## Before and after

Before — data plumbing dominates, and the nesting grows with every attribute:

```js
use(RawData, { data: positions, format: 'vec3<f32>', render: (positions) =>
use(RawData, { data: sizes,     format: 'f32',       render: (sizes) =>
use(RawData, { data: colors,    format: 'vec4<f32>', render: (colors) =>
  use(PointLayer, { positions, sizes, colors, count, shaded: true, depth: 1 })
})})});
```

After — the table is captured once and representations pull from context:

```jsx
<Structure table={table}>
  <Spacefill scale={0.4} />
  <Bonds width={3} />
</Structure>
```

`<Spacefill>` takes no data props at all. That is the intermediary earning its
keep, and it matches CONCEPT 1 (table published via context, not props) and
INVARIANT 5 (appearance is props, data is context).

## What made it possible

`useRawSource(array, format) -> StorageSource` is the **hook-level** equivalent
of the `RawData` component. This is the single most useful discovery here: the
pyramid exists only because `RawData` is a component with a render callback.
With the hook, one component can create many sources in a flat sequence.

## The constraint that shapes the design

**Hooks must run in a stable order, so the uploaded column set must be static.**

`<Structure>` therefore declares a fixed schema:

```js
const COLUMNS = [
  ['positions', 'vec3<f32>'],
  ['radius',    'f32'],
  ['colors',    'vec4<f32>'],
  ['element',   'u32'],
];
```

A column missing from the table still consumes its slot via `useNoRawSource()`.
This rules out the tempting "upload whatever keys the table has" design — an
input-dependent column set means an input-dependent hook count, which breaks
Live's fiber memoization. `@molgpu/table`'s schema being declared up front is
therefore not just tidiness; it is a requirement of the runtime.

## The cost this exposes, and why CONCEPT 3 exists

`<Spacefill>` needs `sizes = radius * scale * k`. `radius` is *already* a GPU
source, but scaling it requires **a second CPU array and a second upload**,
because there is no shader-side expression layer yet:

```js
const sizes = useMemo(() => Float32Array.from(table.radius, r => r * scale * K), [...]);
const sizeSource = useRawSource(sizes, 'f32');
```

Every derived style field costs an allocation plus an upload, and changing
`scale` re-uploads. That is precisely the tax CONCEPT 3 (fields compiling to
WGSL) removes — the next real step is a `useField` that composes a shader over
an existing source instead of materialising a new array. Until then, INVARIANT 4
("style changes never regenerate geometry") holds for *geometry* but not for
derived style buffers.

## Bounds belong to the structure

`computeBounds(table)` is exported as a **plain function** and memoized inside
`<Structure>`, so it serves both the component tree and callers outside it
(camera framing, tests). The example frames itself from `bounds.extent` and
`bounds.center` rather than a magic camera number — which is the shape
`focus(selection)` will take under CONCEPT 5.

Worth noting: centring the molecule turned out to be a framing concern, not a
data concern. The table keeps original PDB coordinates; the camera targets
`bounds.center`. Mutating coordinates to sit at the origin would have been the
wrong fix, and would have broken any later annotation join keyed on position.

## Where derivation lives

`<Bonds>` derives connectivity and builds **per-endpoint** arrays (2 vertices
per bond), which have a different length than the per-atom columns. So:

- the **structure** owns the table and the per-atom sources
- a **representation** owns derivations at its own cardinality

Trying to push bond arrays into `<Structure>`'s fixed schema would be wrong:
they are not atom columns. This suggests a later `<Bonds>` should consume a
*bond table* published by a topology provider, rather than recomputing
`inferBonds` per representation.

## API notes found while building

- `useOne(fn, dep)` takes a **single** dependency; `useMemo(fn, deps[])` takes a
  list. Passing an array to `useOne` gives it a fresh identity every evaluation,
  so it recomputes every time — silently, with no error. Easy bug to ship.
- Context: `makeContext(default, name)`, `provide(ctx, value, children)`,
  `useContext(ctx)`. A `useStructure()` wrapper that throws a named error beats
  letting representations read `null` and fail deeper in.

## Open questions for the real `@molgpu/viewer`

1. **Selections.** `<Spacefill select={...}>` needs an index buffer; does the
   representation upload it, or does `<Structure>` cache selections by identity?
2. **Multiple structures.** Context means one structure per subtree. Comparing
   two structures needs either nested providers with keys, or a registry.
3. **Trajectories.** Swapping `positions` per frame should reupload one column,
   not rebuild the context value. The current `useMemo` on `[table, bounds]`
   invalidates everything when the table identity changes.
4. **The Angstrom-to-sizes factor** stays hardcoded here (bead
   `molgpu-sept-jy6.5`).
