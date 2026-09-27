import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { createStructure, withAttributes } from "@molgpu/table";
import {
  byBfactor,
  byChain,
  byCharge,
  byElement,
  bySecondaryStructure,
  bySeq,
  COLOR,
  columnRange,
  compile,
  evaluate,
} from "../src/index.ts";
import { fixture } from "./fixture.ts";

// The base fixture: 4 atoms C/N/O/S, residues 0,0,1,1, bfactor 10..40, one chain.
const data = createStructure(fixture());
const near = (
  out: Float32Array | string[],
  i: number,
  expected: readonly number[],
  eps = 1e-6,
) => {
  assert(out instanceof Float32Array, "expected a numeric field");
  for (let k = 0; k < 4; k++) {
    assert(
      Math.abs(out[i * 4 + k] - expected[k]) <= eps,
      `row ${i}[${k}]: ${out[i * 4 + k]} != ${expected[k]}`,
    );
  }
};

Deno.test("byElement colours known elements by CPK and others by fallback", () => {
  const f = byElement([0.1, 0.1, 0.1, 1]);
  assertStrictEquals(f.type, COLOR);
  const out = evaluate(f, data); // C, N, O, S
  near(out, 1, [0.35, 0.5, 0.92, 1]); // N blue
  near(out, 2, [0.9, 0.36, 0.33, 1]); // O red
  near(out, 3, [0.95, 0.8, 0.3, 1]); // S yellow
  // an element outside the CPK set falls back
  const argon = createStructure({
    ...fixture(),
    topology: {
      ...fixture().topology,
      atoms: {
        ...fixture().topology.atoms,
        element: Uint8Array.from([18, 6, 8, 16]),
      },
    },
  });
  near(evaluate(f, argon), 0, [0.1, 0.1, 0.1, 1]);
});

Deno.test("byBfactor ramps over its domain and clamps outside it", () => {
  const f = byBfactor({
    domain: [10, 40],
    stops: [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]],
  });
  const out = evaluate(f, data);
  near(out, 0, [0, 0, 0, 1]); // bfactor 10 -> 0
  near(out, 3, [1, 1, 1, 1]); // bfactor 40 -> 1
  // a tighter domain saturates the ends (clamp)
  const tight = evaluate(
    byBfactor({
      domain: [20, 30],
      stops: [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]],
    }),
    data,
  );
  near(tight, 0, [0, 0, 0, 1]);
  near(tight, 3, [1, 1, 1, 1]);
});

Deno.test("bySeq colours atoms along the residue index", () => {
  const domain = columnRange(data, "residue"); // [0, 1] for two residues
  assertEquals(domain, [0, 1]);
  const f = bySeq({ domain, stops: [[0, [1, 0, 0, 1]], [1, [0, 0, 1, 1]]] });
  const out = evaluate(f, data);
  near(out, 0, [1, 0, 0, 1]); // residue 0
  near(out, 3, [0, 0, 1, 1]); // residue 1
});

Deno.test("byChain colours atoms by their chain via the derived atom->chain column", () => {
  // Two chains: residues 0->chain 0, residue 1->chain 1.
  const input = fixture();
  input.topology.residues.chain = Uint32Array.from([0, 1]);
  input.topology.chains = {
    count: 2,
    model: Int32Array.from([1, 1]),
    labelId: ["A", "B"],
    authId: ["A", "B"],
  };
  const two = createStructure(input);
  const f = byChain({ palette: [[1, 0, 0, 1], [0, 1, 0, 1]] });
  const out = evaluate(f, two);
  near(out, 0, [1, 0, 0, 1]); // atom 0, residue 0, chain 0
  near(out, 3, [0, 1, 0, 1]); // atom 3, residue 1, chain 1
});

Deno.test("columnRange handles empty and constant columns", () => {
  assertEquals(columnRange(data, "bfactor"), [10, 40]);
  assertEquals(columnRange(data, "occupancy"), [1, 2]); // all 1 -> [lo, lo+1]
  assertThrows(() => columnRange(data, "nope"), Error, "unknown column");
});

Deno.test("every built-in lowers to WGSL for both targets", () => {
  for (
    const f of [byElement(), byBfactor(), bySeq({ domain: [0, 1] }), byChain()]
  ) {
    assertStrictEquals(compile(f, { domain: "atom" }).valueType, COLOR);
    const linked = compile(f, { domain: "atom", target: "link" });
    assertMatch(linked.wgsl, /@export fn getField\(row: u32\) -> vec4<f32>/);
    assertNotMatch(linked.wgsl, /@group/);
  }
});

Deno.test("byCharge maps charge onto Mol*'s red-white-blue scale", () => {
  // 4 atoms, residues 0,0,1,1 (see fixture.ts).
  const charged = withAttributes(data, {
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      provenance: "user",
      values: Float32Array.of(-1, 0, 1, 5),
    },
    "charge:residueNet": {
      domain: "residue",
      kind: "scalar",
      provenance: "computed:test",
      values: Float32Array.of(-2, 0.5),
    },
  });
  const RED = [191 / 255, 34 / 255, 34 / 255, 1];
  const BLUE = [51 / 255, 97 / 255, 225 / 255, 1];
  const out = evaluate(byCharge(), charged);
  near(out, 0, RED);
  near(out, 1, [1, 1, 1, 1]);
  near(out, 2, BLUE);
  near(out, 3, BLUE); // clamped
  assertEquals(compile(byCharge()).bindings.map((b) => b.id), [
    "attr:partialCharge",
  ]);
  // A residue net-charge column lifted onto atoms.
  const net = evaluate(
    byCharge({ column: "charge:residueNet", lift: true, domain: [-2, 2] }),
    charged,
  );
  near(net, 0, RED);
  near(net, 1, RED);
  // 0.5 on [-2, 2] is a quarter of the way from white to blue.
  near(net, 2, [
    0.75 + 0.25 * 51 / 255,
    0.75 + 0.25 * 97 / 255,
    0.75 + 0.25 * 225 / 255,
    1,
  ]);
  assertEquals(
    compile(byCharge({ column: "charge:residueNet", lift: true })).bindings
      .map((b) => b.id),
    ["attr:residue", "attr:charge:residueNet"],
  );
  // No charge column: the failure names the column.
  assertThrows(() => evaluate(byCharge(), data), TypeError, "partialCharge");
  // Lifting needs a residue column read onto atoms.
  assertThrows(
    () => byCharge({ column: "bfactor", lift: true }),
    TypeError,
    "lift",
  );
});

Deno.test("bySecondaryStructure colours atoms by their residue's ssCode", () => {
  // 4 atoms on residues 0,0,1,1: residue 0 a 3-10 helix (G), residue 1 P.
  const coded = withAttributes(data, {
    ssCode: {
      domain: "residue",
      kind: "code",
      provenance: "computed:dssp",
      values: Uint8Array.of(4, 8),
    },
  });
  const out = evaluate(bySecondaryStructure([0, 0, 0, 1]), coded);
  near(out, 0, [0xa0 / 255, 0, 0x80 / 255, 1]);
  near(out, 1, [0xa0 / 255, 0, 0x80 / 255, 1]);
  near(out, 2, [0, 0, 0, 1]); // P has no colour: fallback
  assertThrows(
    () => evaluate(bySecondaryStructure(), data),
    TypeError,
    "ssCode",
  );
});
