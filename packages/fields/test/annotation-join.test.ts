import {
  assert,
  assertEquals,
  assertMatch,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { createStructure } from "@molgpu/table";
import {
  COLOR,
  type Color,
  colormap,
  compile,
  evaluate,
  type IdentityField,
  joinAnnotation,
  linear,
} from "../src/index.ts";
import { residueIdentity } from "../src/annotation-join.ts";
import { fixture } from "./fixture.ts";

// Base fixture: atoms residue [0,0,1,1]; residues authSeq ['1','2'] on chain 0
// (authId 'A'). Two residues, one chain.
const data = createStructure(fixture());

const records = [
  { chainAuth: "A", authSeq: "1", insCode: "", score: 10 },
  { chainAuth: "A", authSeq: "2", insCode: "", score: 20 },
];
const fields: IdentityField[] = ["chainAuth", "authSeq", "insCode"];

Deno.test("joins per-residue records onto atoms by identity, not sequence alone", () => {
  const f = joinAnnotation(data, records, {
    fields,
    value: (r) => r.score,
    fallback: -1,
  });
  assertStrictEquals(f.domain, "atom"); // lifted
  // atoms 0,1 -> residue 0 -> 10; atoms 2,3 -> residue 1 -> 20
  assertEquals([...evaluate(f, data)], [10, 10, 20, 20]);
});

Deno.test("missing rows follow the policy; a chain field is required", () => {
  const partial = [{ chainAuth: "A", authSeq: "1", insCode: "", score: 7 }]; // residue 2 absent
  const fb = joinAnnotation(data, partial, {
    fields,
    value: (r) => r.score,
    policy: "fallback",
    fallback: -9,
  });
  assertEquals([...evaluate(fb, data)], [7, 7, -9, -9]);
  const strict = joinAnnotation(data, partial, {
    fields,
    value: (r) => r.score,
    policy: "fail",
  });
  assertThrows(() => evaluate(strict, data), Error, "missing value");
  // sequence-alone keys are rejected
  assertThrows(
    () =>
      joinAnnotation(data, records, {
        fields: ["authSeq"],
        value: (r) => r.score,
      }),
    Error,
    "chain field",
  );
});

Deno.test("duplicate keys follow the duplicate policy", () => {
  const dup = [
    { chainAuth: "A", authSeq: "1", insCode: "", score: 1 },
    { chainAuth: "A", authSeq: "1", insCode: "", score: 2 },
    { chainAuth: "A", authSeq: "2", insCode: "", score: 5 },
  ];
  assertThrows(
    () => joinAnnotation(data, dup, { fields, value: (r) => r.score }),
    Error,
    "duplicate",
  );
  assertStrictEquals(
    evaluate(
      joinAnnotation(data, dup, {
        fields,
        value: (r) => r.score,
        duplicate: "first",
        fallback: 0,
      }),
      data,
    )[0],
    1,
  );
  assertStrictEquals(
    evaluate(
      joinAnnotation(data, dup, {
        fields,
        value: (r) => r.score,
        duplicate: "last",
        fallback: 0,
      }),
      data,
    )[0],
    2,
  );
});

Deno.test("a joined annotation is an ordinary field: colormap it and lower to WGSL", () => {
  const scoreField = joinAnnotation(data, records, {
    fields,
    value: (r) => r.score,
    fallback: 0,
  });
  const coloured = colormap(linear(scoreField, { domain: [10, 20] }), [[0, [
    0,
    0,
    0,
    1,
  ]], [1, [1, 1, 1, 1]]]);
  const out = evaluate(coloured, data);
  assertEquals([...out.slice(0, 4)], [0, 0, 0, 1]); // score 10 -> black
  assertEquals([...out.slice(12)], [1, 1, 1, 1]); // score 20 -> white
  const linked = compile(coloured, { domain: "atom", target: "link" });
  assertMatch(linked.wgsl, /@export fn getField\(row: u32\) -> vec4<f32>/);
  assertStrictEquals(linked.bindings[0].id, "annotation"); // the joined column is the input
});

Deno.test("colour-typed annotations join and keep [r,g,b,a] per residue", () => {
  const colours: {
    chainAuth: string;
    authSeq: string;
    insCode: string;
    rgba: Color;
  }[] = [
    { chainAuth: "A", authSeq: "1", insCode: "", rgba: [1, 0, 0, 1] },
    { chainAuth: "A", authSeq: "2", insCode: "", rgba: [0, 1, 0, 1] },
  ];
  const f = joinAnnotation(data, colours, {
    fields,
    type: COLOR,
    value: (r) => r.rgba,
    fallback: [0, 0, 0, 1],
  });
  const out = evaluate(f, data);
  assertEquals([...out.slice(0, 4)], [1, 0, 0, 1]); // atom 0 (residue 0)
  assertEquals([...out.slice(12)], [0, 1, 0, 1]); // atom 3 (residue 1)
});

Deno.test("residueIdentity exposes the full identity, not just sequence", () => {
  const id = residueIdentity(data, 0);
  assertStrictEquals(id.chainAuth, "A");
  assertStrictEquals(id.authSeq, "1");
  assert(
    "model" in id && "chainLabel" in id && "insCode" in id && "comp" in id,
  );
});
