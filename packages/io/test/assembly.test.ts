// Biological assembly lowering (molgpu-sept-fch.1): instance rows from
// pdbx_struct_assembly_gen, checked against the raw pdbx_struct_oper_list
// columns read independently from the CIF.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { CIF } from "molstar/lib/mol-io/reader/cif.js";
import { IoError, structureFromBcif } from "../src/index.ts";

const bytes = await Deno.readFile(
  new URL("./fixtures/1tqn.bcif", import.meta.url),
);

/** Column-major affine of each pdbx_struct_oper_list row, by id. */
async function operators(): Promise<Map<string, number[]>> {
  const parsed = await CIF.parseBinary(bytes).run();
  if (parsed.isError) throw new Error(parsed.message);
  const oper = parsed.result.blocks[0].categories["pdbx_struct_oper_list"]!;
  const out = new Map<string, number[]>();
  for (let i = 0; i < oper.rowCount; i++) {
    const m = new Array(16).fill(0);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        m[c * 4 + r] = oper.getField(`matrix[${r + 1}][${c + 1}]`)!.float(i);
      }
      m[12 + r] = oper.getField(`vector[${r + 1}]`)!.float(i);
    }
    m[15] = 1;
    out.set(oper.getField("id")!.str(i), m);
  }
  return out;
}

Deno.test("assembly: default is one identity instance per chain", async () => {
  const data = await structureFromBcif(bytes);
  const { chains, instances } = data.topology;
  assertEquals(instances.count, chains.count);
  assert(instances.operatorId.every((id) => id === "identity"));
});

Deno.test("assembly: 1tqn assembly 2 expands four operators over A, B, C", async () => {
  const base = await structureFromBcif(bytes);
  const data = await structureFromBcif(bytes, { assembly: "2" });
  const { chains, instances, atoms } = data.topology;
  assertEquals(atoms.count, base.topology.atoms.count, "atoms never duplicate");
  const asyms = Array.from(instances.chain, (c) => chains.labelId[c]);
  assertEquals(new Set(asyms), new Set(["A", "B", "C"]));
  assertEquals(
    [...new Set(instances.operatorId)].sort(),
    ["1", "2", "3", "4"],
  );
  assertEquals(instances.count, 3 * 4);
  const reference = await operators();
  for (let k = 0; k < instances.count; k++) {
    const expected = reference.get(instances.operatorId[k])!;
    const got = Array.from(instances.transform.subarray(k * 16, k * 16 + 16));
    got.forEach((v, i) =>
      assert(
        Math.abs(v - expected[i]) < 1e-6,
        `row ${k} op ${instances.operatorId[k]}[${i}]: ${v} vs ${expected[i]}`,
      )
    );
  }
});

Deno.test("assembly: assembly 1 is the identity over A, B, C only", async () => {
  const data = await structureFromBcif(bytes, { assembly: "1" });
  const { chains, instances } = data.topology;
  assertEquals(
    Array.from(instances.chain, (c) => chains.labelId[c]).sort(),
    ["A", "B", "C"],
  );
  assert(instances.operatorId.every((id) => id === "1"));
});

Deno.test("assembly: an unknown id is a named error", async () => {
  const error = await assertRejects(
    () => structureFromBcif(bytes, { assembly: "9" }),
    IoError,
  );
  assertEquals((error as IoError).code, "UNKNOWN_ASSEMBLY");
});
