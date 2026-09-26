# The typed `.tsx` consumer boundary

`@molgpu/viewer` ships hand-written declarations at
`packages/viewer/src/index.d.ts`, selected through the package's `exports.types`
condition, matching the pattern `@molgpu/table` already used. `@molgpu/io`
gained the same treatment so a typed consumer can name `BcifParseError` and its
`code` without reaching into the implementation. Nothing in
`packages/*/src/*.mjs` is compiled: TypeScript is a development-only check over
declarations the runtime does not read.

`<Structure>`'s mutual exclusion is encoded as a union rather than a comment:

```ts
export type StructureProps = PreloadedStructureProps | LoadedStructureProps;
```

`PreloadedStructureProps` declares `src?: undefined`, so
`<Structure data={d}
src="/1crn.bcif">` fails to compile with the same meaning
the constructor's `TypeError` carries at runtime. `npm run test:components`
asserts both halves, because a type that drifts from its runtime guard is worse
than neither.

## What the browser check proves

`packages/viewer/test/tsx/consumer.tsx` is a real application, not a harness
shim: `npm run typecheck` compiles it under `strict`, `npm run test:components`
builds it with vite and drives it in a fresh Chrome WebGPU tab. The runner
reports to `packages/viewer/test/results/components.json`.

| State              | Assertion                                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| preloaded `data`   | one cluster drawn; **zero** requests for the named `molstar` chunk           |
| invalid props      | the four runtime `TypeError`s the types also reject                          |
| empty structure    | no GPU source, nothing drawn, no errors                                      |
| sibling structures | two clusters, each with its own radii and coordinates                        |
| replaced `src`     | the outstanding request reports cancelled; no stale mount, no stale draw     |
| absent `src`       | phase history `loading → error`; the error prop receives the 404             |
| pinned 1CRN `src`  | phase history `loading → ready`; 327 atoms; the lazy parser chunk is fetched |
| unmount / remount  | the subtree disappears and returns                                           |

Two details make those assertions meaningful rather than decorative. Each
measurement requires two byte-identical consecutive canvas frames before
analysing connected components, so a state is read after its transient resource
work reaches a fixed point. And the fixture records a phase _history_: a
327-atom BCIF load finishes inside a single settle window, so sampling only the
resting phase would never observe the loading prop at all.

Vite names the parser chunk through `manualChunks`, which is what turns "a
preloaded dataset must not load Mol\*" into an observable network fact instead
of an intention.

## A defect the error state surfaced

`<Structure>` could not reach its `error` prop. The guard read:

```js
if (pending || loaded === undefined) return loading;
if (failure) return error;
```

`useAwait` resolves a failed request to `[undefined, error]`, so `loaded` is
always `undefined` on failure and the error branch was unreachable: a failing
source showed the loading state forever. Checking `pending` alone first, then
`failure`, restores it. The loader is now also invoked through an `async`
wrapper, so a loader that throws synchronously becomes a rejection the `error`
prop can render rather than an exception thrown during render.

`useStructure()` now throws when it has no `<Structure>` ancestor, matching the
earlier exploratory implementation and letting the declaration promise a value
instead of `undefined`.

## Limits

`<Structure>` treats its `loader` prop as a reload dependency alongside `src`,
so an inline arrow reloads on every render; the declaration says so. Node cannot
import `@use-gpu/workbench`, so `<Structure>` and `<Spacefill>` have no
node:test coverage — their contracts live in the browser runner, and only
`<Molecule>` is unit-tested.
