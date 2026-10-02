// Historical source-evidence probe: asserts discrepancies present at e2b4df7.
// This is not a production regression test or a GPU execution probe.
// Run from repository root:
// deno run docs/findings/evidence/2026-10-02-second-pass-pure-probe.ts
import { assert, assertEquals, assertMatch } from "@std/assert";
import { compile, constant, evaluate, linear } from "@molgpu/fields";
import { marchingCubes } from "@molgpu/geo";
import { createStructure } from "@molgpu/table";

const data = createStructure({
  positions: Float32Array.of(0, 0, 0),
  topology: {
    atoms: {
      count: 1,
      id: ["1"],
      name: ["CA"],
      altloc: [""],
      residue: Uint32Array.of(0),
      element: Uint8Array.of(6),
      occupancy: Float32Array.of(1),
      bfactor: Float32Array.of(0),
    },
    residues: {
      count: 1,
      chain: Uint32Array.of(0),
      labelSeq: Int32Array.of(1),
      authSeq: ["1"],
      insertionCode: [""],
      comp: ["ALA"],
      polymer: ["protein"],
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
      count: 0,
      chain: new Uint32Array(),
      operatorId: [],
      transform: new Float64Array(),
    },
  },
});

const wrapped = linear(constant(1), {
  domain: [0, 1],
  range: [10, 20],
  overflow: "wrap",
});
const cpu = evaluate(wrapped, data, { domain: "atom" });
assertEquals(cpu, Float32Array.of(20));
const wrapWgsl = compile(wrapped).wgsl;
assertEquals(
  wrapWgsl,
  "fn evalField(row: u32) -> f32 {\n" +
    "  return (fract(((1.0) - 0.0) / 1.0)) * 10.0 + 10.0;\n}\n",
);
// Evaluate the exact emitted expression's arithmetic using WGSL fract's
// definition. This confirms expression disagreement, not dispatched GPU output.
const u = (1 - 0) / 1;
const emittedExpression = (u - Math.floor(u)) * 10 + 10;
assertEquals(emittedExpression, 10);
assert(cpu[0] !== emittedExpression);

const literals = [NaN, Infinity, 1e21].map((value) => ({
  input: String(value),
  wgsl: compile(constant(value)).wgsl.trim(),
}));
assertMatch(literals[0].wgsl, /return NaN;/);
assertMatch(literals[1].wgsl, /return Infinity;/);
assertMatch(literals[2].wgsl, /return 1e\+21\.0;/);
const nonfiniteDomain = compile(
  linear(constant(1), { domain: [NaN, 1] }),
).wgsl.trim();
assertMatch(nonfiniteDomain, /NaN/);

const grid = {
  values: Float32Array.of(0, 1, 1, 2, 0, 1, 1, 2),
  dims: [2, 2, 2] as const,
  level: .5,
};
const spacing = marchingCubes({ ...grid, spacing: [2, 1, 1] });
const affine = marchingCubes({
  ...grid,
  transform: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});
assertEquals(spacing.positions, affine.positions);
assertEquals(spacing.indices, affine.indices);
const spacingNormal = spacing.normals.slice(0, 3);
const affineNormal = affine.normals.slice(0, 3);
assert(Math.abs(spacingNormal[0] - affineNormal[0]) > .2);
assert(Math.abs(affineNormal[0] / affineNormal[1] - .5) < 1e-6);
assert(Math.abs(spacingNormal[0] / spacingNormal[1] - 1) < 1e-6);

console.log(JSON.stringify(
  {
    baseline: "e2b4df7",
    wrap: { cpu: [...cpu], emittedExpression, wgsl: wrapWgsl.trim() },
    literals,
    nonfiniteDomain,
    spacing: {
      identicalPositionsAndIndices: true,
      spacingNormal: [...spacingNormal],
      affineNormal: [...affineNormal],
    },
    gpuDispatched: false,
  },
  null,
  2,
));
