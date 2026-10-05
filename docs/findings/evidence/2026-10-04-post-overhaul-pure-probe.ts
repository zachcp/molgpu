import { createStructure } from "@molgpu/table";
import { resolve, where } from "@molgpu/select";

// Valid 1,000-row structure, with one unique atom name per row.
const n = 1000;
const data = createStructure({
  positions: new Float32Array(n * 3),
  topology: {
    atoms: {
      count: n,
      id: Array.from({ length: n }, (_, i) => String(i)),
      name: Array.from({ length: n }, (_, i) => `A${i}`),
      altloc: Array(n).fill(""),
      residue: new Uint32Array(n),
      element: new Uint8Array(n).fill(6),
      occupancy: new Float32Array(n).fill(1),
      bfactor: new Float32Array(n),
    },
    residues: {
      count: 1,
      chain: Uint32Array.of(0),
      labelSeq: Int32Array.of(1),
      authSeq: ["1"],
      insertionCode: [""],
      comp: ["UNK"],
      polymer: ["other"],
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
const a = [265, 316, 363, 518, 554];
const b = [176, 293, 558, 652, 787];
const selection = (rows: number[]) =>
  resolve(
    where("atom", "collision", (_, row) => rows.includes(row), ["topology"]),
    data,
  );
const left = selection(a), right = selection(b);
if (String(left.indices) === String(right.indices)) {
  throw new Error("expected different membership");
}
if (left.id !== right.id) {
  throw new Error(
    "baseline collision no longer reproduces; replace with regression assertion",
  );
}
console.log(
  JSON.stringify({
    left: [...left.indices],
    right: [...right.indices],
    id: left.id,
  }),
);
