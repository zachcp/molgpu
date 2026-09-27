import { assert, assertEquals } from "@std/assert";
import {
  activeAtoms,
  attributeColumn,
  secondaryStructureTrace,
  type StructureData,
  traceTable,
  withSecondaryStructure,
} from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { ribbonDsspRows } from "../src/internal/ribbon-dssp.ts";

// 2k39: an NMR ensemble, so every model has its own coordinates.
const DATA = await structureFromBcif(
  new Uint8Array(
    await Deno.readFile(
      new URL("../../io/test/fixtures/2k39.bcif", import.meta.url),
    ),
  ),
);
const { atoms, residues, chains } = DATA.topology;
const modelOf = (row: number) =>
  chains.model[residues.chain[atoms.residue[row]]];
const MODELS = [...new Set(chains.model)];

/** What <Ribbon secondaryStructure="dssp" select={rows}> draws. */
function drawn(rows: Uint32Array) {
  const data = withSecondaryStructure(DATA, {
    mode: "dssp",
    rows: ribbonDsspRows(DATA, rows),
  });
  return {
    data,
    ss: secondaryStructureTrace(data, rows, traceTable(data, rows)),
  };
}
const codes = (data: StructureData) => attributeColumn(data, "ssCode")!.values;
/** Per-residue codes of one model, from DSSP over that model alone. */
const alone = (model: number) =>
  codes(withSecondaryStructure(DATA, {
    mode: "dssp",
    rows: activeAtoms(DATA, { model }),
  }));
const residuesOf = (
  rows: ArrayLike<number>,
) => [...new Set(Array.from(rows, (row) => atoms.residue[row]))];

Deno.test("a DSSP ribbon of model 2 draws model 2's helices and sheets", () => {
  const model2 = activeAtoms(DATA, { model: MODELS[1] });
  const { ss } = drawn(model2);
  const structured = ss.kind.filter((kind) => kind !== "coil").length;
  // Before efv.10 DSSP ran on the first model only, and this was all coil.
  const before = secondaryStructureTrace(
    withSecondaryStructure(DATA, { mode: "dssp", rows: activeAtoms(DATA) }),
    model2,
    traceTable(DATA, model2),
  );
  assertEquals(before.kind.filter((kind) => kind !== "coil").length, 0);
  assert(structured > 0, "model 2 has helix or sheet samples");
  const want = alone(MODELS[1]);
  const { data } = drawn(model2);
  for (const r of residuesOf(model2)) assertEquals(codes(data)[r], want[r]);
});

Deno.test("a selection spanning models assigns each from its own coordinates", () => {
  const spanning = Uint32Array.from(
    activeAtoms(DATA, { model: "all" }).filter((row) =>
      modelOf(row) === MODELS[0] || modelOf(row) === MODELS[2]
    ),
  );
  const { data } = drawn(spanning);
  for (const model of [MODELS[0], MODELS[2]]) {
    const want = alone(model);
    const rows = spanning.filter((row) => modelOf(row) === model);
    for (const r of residuesOf(rows)) assertEquals(codes(data)[r], want[r]);
  }
});

Deno.test("part of a model gets the codes of the whole model", () => {
  const model2 = activeAtoms(DATA, { model: MODELS[1] });
  const first = residuesOf(model2).slice(0, 30);
  const part = model2.filter((row) => first.includes(atoms.residue[row]));
  const { data } = drawn(part);
  const want = alone(MODELS[1]);
  for (const r of first) assertEquals(codes(data)[r], want[r]);
});

Deno.test("the default ribbon rows still run DSSP on the first model", () => {
  assertEquals(ribbonDsspRows(DATA, activeAtoms(DATA)), activeAtoms(DATA));
});
