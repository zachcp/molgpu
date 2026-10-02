// Mol* oracle for @molgpu/table's DSSP port (efv.5): per-residue codes equal
// Mol*'s computeUnitDSSP on every corpus unit (one chain in one model), with
// the one documented difference from Mol*'s assignBends bug.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { CIF } from "molstar/lib/mol-io/reader/cif.js";
import { trajectoryFromMmCIF } from "molstar/lib/mol-model-formats/structure/mmcif.js";
import { Structure, Unit } from "molstar/lib/mol-model/structure.js";
import { Task } from "molstar/lib/mol-task/index.js";
import {
  computeUnitDSSP,
  DefaultDSSPComputationProps,
} from "molstar/lib/mol-model-props/computed/secondary-structure/dssp.js";
import {
  activeAtoms,
  attributeColumn,
  createStructure,
  dssp,
  SS_CODES,
  withAttributes,
  withPositions,
  withSecondaryStructure,
} from "@molgpu/table";
import { trajectoryFromModels } from "../../table/src/trajectory.ts";
import { structureFromBcif } from "../src/index.ts";
import { corpus } from "./corpus.ts";

// Mol* 5.11 SecondaryStructureDssp values (const enum flags) -> DSSP letter.
const MOLSTAR: Record<number, string> = {
  0: "-",
  [2 | 4096]: "H",
  [4 | 4194304]: "B",
  [4 | 8388608]: "E",
  [2 | 2048]: "G",
  [2 | 32768]: "I",
  [16]: "T",
  [8]: "S",
};

for (const entry of corpus) {
  Deno.test(`${entry.id}: DSSP codes equal Mol*'s computeUnitDSSP`, async () => {
    const bytes = await Deno.readFile(
      new URL(`./fixtures/${entry.id}.bcif`, import.meta.url),
    );
    const data = await structureFromBcif(bytes);
    // Every model, and every altloc so the first conformer in file order is
    // read, as Mol*'s findAtomOnResidue does.
    const codes = dssp(data, {
      rows: activeAtoms(data, { model: "all", altloc: "all" }),
    });
    const parsed = await CIF.parseBinary(bytes).run();
    if (parsed.isError) throw new Error(parsed.message);
    const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0]).run();
    // Mol*'s atomSourceIndex counts from each model's first atom_site row.
    const { atoms, residues, chains } = data.topology;
    const modelStart: number[] = [];
    for (let i = 0, last = NaN; i < atoms.count; i++) {
      const model = chains.model[residues.chain[atoms.residue[i]]];
      if (model !== last) modelStart.push(i);
      last = model;
    }
    let compared = 0, bendBug = 0, secondary = 0;
    const mismatches: string[] = [];
    for (let f = 0; f < trajectory.frameCount; f++) {
      const model = await Task.resolveInContext(trajectory.getFrameAtIndex(f));
      const structure = Structure.ofModel(model);
      const { atomSourceIndex, residueAtomSegments } = model.atomicHierarchy;
      for (const unit of structure.units) {
        if (!Unit.isAtomic(unit) || !unit.proteinElements.length) continue;
        const ss = await computeUnitDSSP(unit, DefaultDSSPComputationProps);
        const residueIndices = Array.from(
          unit.proteinElements as ArrayLike<number>,
          (e) => unit.residueIndex[e] as number,
        );
        // Mol*'s bend bug is invisible only where list index = residue index.
        const bugFree = residueIndices.every((rI, i) => rI === i);
        for (const rI of residueIndices) {
          const source = modelStart[f] +
            atomSourceIndex.value(residueAtomSegments.offsets[rI]);
          const residue = data.topology.atoms.residue[source];
          const ours = SS_CODES[codes[residue]];
          const theirs = MOLSTAR[ss.type[ss.getIndex(rI as never)]];
          compared++;
          if (ours !== "-") secondary++;
          if (ours === theirs) continue;
          if (!bugFree && ours === "S" && theirs === "-") {
            bendBug++;
            continue;
          }
          mismatches.push(
            `model ${f} residue ${residue}: ${ours} vs ${theirs}`,
          );
        }
      }
    }
    assertEquals(mismatches, [], `${entry.id} (${compared} residues)`);
    if (entry.id === "1bna") {
      assertEquals(compared, 0);
      assert(codes.every((c) => c === 0));
    } else {
      assert(compared > 0 && secondary > 0);
    }
    if (bendBug) {
      console.log(`${entry.id}: ${bendBug} S kept over Mol*'s bend bug`);
    }
  });
}

const load = async (id: string) =>
  structureFromBcif(
    await Deno.readFile(new URL(`./fixtures/${id}.bcif`, import.meta.url)),
  );
const provenance = (data: Parameters<typeof attributeColumn>[0]) =>
  attributeColumn(data, "ssCode")?.provenance;

Deno.test("withSecondaryStructure follows Mol*'s auto, dssp and model modes", async () => {
  const crn = await load("1crn");
  // Imported annotation: auto and model keep it; dssp replaces it.
  assertStrictEquals(withSecondaryStructure(crn), crn);
  assertStrictEquals(withSecondaryStructure(crn, { mode: "model" }), crn);
  const computed = withSecondaryStructure(crn, { mode: "dssp" });
  assertEquals(provenance(computed), "computed:dssp");
  assertEquals(
    [...attributeColumn(computed, "ssCode")!.values],
    [...dssp(crn)],
  );
  assertEquals(computed.revision.topology, crn.revision.topology);
  // No annotation in the file (default zeros): auto computes.
  const bna = await load("1bna");
  assertEquals(provenance(bna), "default");
  assertEquals(provenance(withSecondaryStructure(bna)), "computed:dssp");
  // A user column is kept by auto.
  const { topology, positions } = crn;
  const bareCrn = createStructure({ positions, topology });
  const user = withAttributes(bareCrn, {
    ssCode: {
      domain: "residue",
      kind: "code",
      provenance: "user",
      values: new Uint8Array(topology.residues.count),
    },
  });
  assertStrictEquals(withSecondaryStructure(user), user);
  // No column at all: auto computes.
  const bare = createStructure({ positions, topology });
  assertEquals(provenance(bare), undefined);
  assertEquals(provenance(withSecondaryStructure(bare)), "computed:dssp");
  assertThrows(
    () => withSecondaryStructure(crn, { mode: "kabsch" as "dssp" }),
    TypeError,
    "mode",
  );
});

Deno.test("per-frame DSSP of an NMR ensemble equals DSSP of each model", async () => {
  const data = await load("2k39");
  const trajectory = trajectoryFromModels(data);
  const map = trajectory.atomMap!;
  const rows = activeAtoms(data);
  // Scatter frame k (model k) into the first model's rows, then run DSSP over
  // the default view: the per-frame path a trajectory consumer would take.
  const frameCodes = async (index: number) => {
    const frame = await trajectory.source.read(index);
    const positions = data.positions.slice();
    for (let i = 0; i < map.length; i++) {
      positions.set(frame.positions.subarray(i * 3, i * 3 + 3), map[i] * 3);
    }
    return dssp(withPositions(data, positions), { rows });
  };
  const whole = dssp(data); // every model at once
  const { residues, chains } = data.topology;
  const modelOf = (r: number) => chains.model[residues.chain[r]];
  const models = [
    ...new Set(Array.from({ length: residues.count }, (_, r) => modelOf(r))),
  ];
  const residuesOf = (model: number) =>
    Array.from({ length: residues.count }, (_, r) => r).filter((r) =>
      modelOf(r) === model
    );
  const first = residuesOf(models[0]);
  for (const f of [0, 1, 57, trajectory.frameCount - 1]) {
    const codes = await frameCodes(f);
    const expected = residuesOf(models[f]).map((r) => whole[r]);
    assertEquals(first.map((r) => codes[r]), expected, `frame ${f}`);
  }
  await assertRejects(
    () => trajectory.source.read(trajectory.frameCount),
    RangeError,
  );
});
