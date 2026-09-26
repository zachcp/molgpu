import { assertEquals, assertStrictEquals } from "@std/assert";
import { type PickEntry, resolvePick } from "../src/internal/pick-resolve.ts";
import type { StructureResource } from "../src/types.ts";

// The live picking hook and the GPU readback are exercised in the browser
// runner; this covers the pure sample -> atom resolution.

// Resolution never touches the resource; a name stands in for it.
const resource = (name: string) => name as unknown as StructureResource;
const registry = new Map<number, PickEntry>([
  [7, { resource: resource("R-all"), indices: null }],
  [9, { resource: resource("R-sel"), indices: Uint32Array.of(4, 11, 20) }],
]);
const get = (id: number) => registry.get(id) ?? null;

Deno.test("no sample, or a too-short sample, resolves to null", () => {
  assertStrictEquals(resolvePick(null, get), null);
  assertStrictEquals(resolvePick([5], get), null);
});

Deno.test("object id 0 is the background clear value", () => {
  assertStrictEquals(resolvePick([0, 3], get), null);
});

Deno.test("an id not in the registry resolves to null", () => {
  assertStrictEquals(resolvePick([42, 3], get), null);
});

Deno.test("a whole-structure pickable maps instance index straight to the atom row", () => {
  assertEquals(resolvePick([7, 3], get), {
    id: 7,
    resource: resource("R-all"),
    atom: 3,
    instance: 3,
  });
});

Deno.test("a selection pickable maps the instance index through its indices", () => {
  assertEquals(resolvePick([9, 2], get), {
    id: 9,
    resource: resource("R-sel"),
    atom: 20,
    instance: 2,
  });
});

Deno.test("an instance index outside the selection resolves to null", () => {
  assertStrictEquals(resolvePick([9, 3], get), null);
  assertStrictEquals(resolvePick([9, -1], get), null);
});
