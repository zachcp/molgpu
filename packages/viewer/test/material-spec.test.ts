import {
  assert,
  assertEquals,
  assertMatch,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  materialTypes,
  resolveMaterial,
} from "../src/internal/material-spec.ts";
import type { ViewerElement } from "../src/types.ts";

const materialOf = (spec: Parameters<typeof resolveMaterial>[0]) => {
  const resolved = resolveMaterial(spec);
  assert(resolved.kind === "material");
  return resolved;
};

// The material components themselves reach @use-gpu/workbench, which Node cannot
// import; the pure spec resolution lives here so withMaterial's decision logic
// is unit-tested, and the actual MaterialContext wiring is asserted in the
// browser runner (run-materials.mjs).

Deno.test("null/undefined resolve to no material", () => {
  assertEquals(resolveMaterial(null), { kind: "none" });
  assertEquals(resolveMaterial(undefined), { kind: "none" });
});

Deno.test("a function is a wrapper escape hatch, returned as-is", () => {
  const wrap = (children: ViewerElement) => children;
  const resolved = resolveMaterial(wrap);
  assert(resolved.kind === "wrap");
  assertStrictEquals(resolved.wrap, wrap);
});

Deno.test("a bare spec defaults to the pbr type and forwards the rest as props", () => {
  const resolved = materialOf({ metalness: 0.8, roughness: 0.2 });
  assertStrictEquals(resolved.type, "pbr");
  assertEquals(resolved.props, { metalness: 0.8, roughness: 0.2 });
});

Deno.test("an explicit type is honoured and not left in props", () => {
  const resolved = materialOf({ type: "basic", color: [1, 0, 0, 1] });
  assertStrictEquals(resolved.type, "basic");
  assertEquals(resolved.props, { color: [1, 0, 0, 1] });
});

Deno.test("every advertised material type resolves", () => {
  for (const type of materialTypes) {
    assertStrictEquals(materialOf({ type }).type, type);
  }
});

Deno.test("an unknown type throws, naming the valid set", () => {
  assertMatch(
    // @ts-expect-error: not a material type
    (assertThrows(() => resolveMaterial({ type: "glass" }), Error)).message,
    /Unknown material type 'glass'.*pbr/,
  );
});

Deno.test("a non-spec, non-function value throws", () => {
  assertMatch(
    // @ts-expect-error: an array is not a spec
    (assertThrows(() => resolveMaterial([1, 2, 3]), Error)).message,
    /spec object, a wrapper function, or null/,
  );
  assertMatch(
    // @ts-expect-error: a number is not a spec
    (assertThrows(() => resolveMaterial(42), Error)).message,
    /spec object, a wrapper function, or null/,
  );
});
