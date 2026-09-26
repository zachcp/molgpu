# Selections, and whether cartoon is a mesh monstrosity

The retired selection and tube experiments were both verified before their
behavior moved into the package suite.

## Part 1 — what a selection IS

Syntax is the last decision, not the first. The thing to pin down is the runtime
value, and the `<Structure>` exercise already showed why: getting the _value_
shape right is what made the component simple.

```js
Selection = {
  domain: "atom" | "residue" | "bond",
  indices: Uint32Array,
  key: string,
};
```

Three parts, each load-bearing:

**`domain`** — a selection is only meaningful against the domain it was built
for. Atoms, residues and bonds have different cardinality: spacefill wants atom
indices, cartoon wants residue indices, and `<Bonds>` already builds
per-endpoint arrays that are neither. Set ops assert matching domains rather
than silently producing garbage. This is the same lesson as the fixed column
schema — cardinality is part of the type.

**`indices`** — sorted, so union / intersect / difference are cheap set ops and
one selection can be reused in five places. This is CONCEPT 2's "selections are
values, not nodes."

**`key`** — a stable string identity, so geometry memoizes on the selection
without deep-comparing index arrays. `<Spacefill>` memoizes on `select?.key`.
Without this, every evaluation looks like a new selection and rebuilds.

### Syntax, deliberately last

`where(table, key, predicate)` with named helpers on top (`element(table, S)`).
Predicates run **once at selection time, never per frame**, so a JS closure per
atom is fine even at a million atoms. Per risk R6 there is no query language
yet; a PyMOL/VMD-style string parser (`"chain A and resi 1-20"`) is the obvious
eventual affordance for this audience, but it is a parser and it can wait until
someone asks.

### How a selection reaches the GPU — and the upstream bug

The design we want is an **indirect draw**: leave the full per-atom buffers
bound and untouched, and hand the layer an index buffer. `RawQuads` supports
exactly this via `instances` ("instanced draw, repeated or random access"), and
`PointLayer` forwards it through its `...rest`. Selections would then cost one
small u32 upload and nothing else, and INVARIANT 4 would hold perfectly.

**It is broken in use.gpu 0.20.0.** Passing `instances` makes the generated
vertex shader emit

```wgsl
fn _0a_loadInstance(a: u32) -> void { ... }
```

and `void` is not a WGSL type, so the module fails to compile and the layer
draws nothing. Confirmed in a clean tab (the shader name `vertex/instanced`
appears only in this configuration, and the bonds in the same scene still
render). This is the **third** independent WGSL codegen defect found in 0.20.0,
after `DualContourLayer`'s two.

So today selections **gather**: `<Spacefill>` compacts positions, colors and
sizes for the selected subset and uploads those. Correct, and verified — but it
costs uploads proportional to the selection every time it changes, which is
precisely what indirect draw avoids. The gather is written as an explicitly
marked fallback so it can be swapped for `instances` once upstream is fixed.

Consequence for the roadmap: **Gate 2 cannot be fully met on 0.20.0.** "One
selection drives three representations without regenerating geometry" is
achievable for geometry, but each representation re-uploads its own compacted
style buffers.

## Part 2 — is cartoon a giant mesh monstrosity?

Partly. It splits cleanly, and one half is much cheaper than expected.

### Cartoon is two stages, not one

1. **Trace extraction** (per residue): walk the polymer, produce guide points
   plus orientation frames and a secondary-structure label. This is the half
   that is _not_ portable from Mol\* — `trace-iterator` is coupled to `Unit`,
   `StructureElement`, `SecondaryStructureProvider`. Risk R1 lives here.
2. **Extrusion** (geometry): sweep a cross-section along the spline.

Stage 1's output is **small and table-shaped**: N residues x (position, tangent,
normal, ss-type, width). That is just another columnar table, so it fits the
existing architecture — a residue-level table published alongside the atom one.
It is not a monstrosity; it is an iterator plus DSSP.

### The cheap half: tubes need no mesh at all

`RawLines` imports `@use-gpu/wgsl/geometry/tube` and sets
`LINE_STRIP_DETAIL = sides` when `shaded` is true, with
`vertexCount = quads * (2 * (3 + sides))`. **The tube extrusion happens on the
GPU.**

Verified (`?ex=tube`): feeding backbone points to `LineLayer` with
`shaded: true, sides: 8` and a per-point `widths` source produces shaded 3D
tubes with **zero CPU mesh building**. Per-point width is a bound field, so a
tube can taper without regenerating anything.

That means the whole **tube / worm / backbone-trace** family — which is a large
share of real molecular figures — is nearly free and respects INVARIANT 4.

Caveat found: the width/depth semantics are finicky. `depth: -1` (absolute world
sizing) works with a small width; `width >= ~3` at `depth: -1` renders
**nothing, with no error**. Same silent-failure class as `FaceLayer`'s
`side: 'front'` culling. Needs pinning down before it is relied on.

### The expensive half: flat ribbons and arrow sheets

A proper cartoon — flat oriented ribbons, helix ribbons, beta arrows with
shoulders — needs a cross-section that is _oriented_ per point (the residue
frame) and _varies_ in profile and width. `LineLayer`'s tube extrusion gives a
circular cross-section around the path tangent; it has no place to accept a
per-point normal/binormal frame.

So that genuinely is a mesh build: port Mol\*'s `curve-segment` math (portable,
mol-math only) and extrude into `FaceLayer` via `GeometryData`. Size estimate:
~12 cross-section samples x ~10 ring vertices per residue, so a 3000-residue
structure lands around 360k vertices. Comfortable for the GPU; the cost is the
**CPU build and its invalidation** — any geometry-param change re-extrudes.

### The honest answer

- **Backbone / tube / worm:** not a monstrosity. `LineLayer` + `sides` + bound
  `widths`, no mesh.
- **Flat ribbon + arrows:** yes, a real mesh build, and it is the long pole
  (Phase 4, risk R1) — but the _geometry_ half ports from Mol\* and only the
  _traversal_ half must be written.
- **A third option worth considering later:** a custom WGSL vertex shader that
  extrudes an oriented cross-section on the GPU, i.e. what `tube.wgsl` does but
  taking a per-point frame. That would make ribbons as cheap as tubes and is a
  far smaller piece of work than reimplementing Mol\*'s geometry — but it is
  custom shader work, so it should not be attempted until the CPU path exists
  and is correct enough to diff against.

## Recommendation

Stage cartoon so the cheap win lands first:

1. residue-level trace table (the reusable foundation for all variants)
2. tube/worm via `LineLayer` — validates the trace table with no mesh code
3. CPU ribbon extrusion into `FaceLayer`, gated by the golden-file harness
4. only then consider a GPU frame-aware extrusion shader
