// Test support: an NMR multi-model structure as a trajectory over the same
// structure. Frame `k` holds model `k`'s coordinates, in the order models are
// first encountered, and `atomMap` points at the rows of the first model (the
// model the default view policy shows). Every model must list the same atoms
// in the same order; the first difference throws a `TypeError` naming the
// model and row. A single-model structure gives one frame and no `atomMap`.
import {
  createTrajectory,
  type StructureData,
  type TrajectoryData,
} from "@molgpu/table";

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};

export function trajectoryFromModels(data: StructureData): TrajectoryData {
  const { atoms: a, residues: r, chains: c } = data.topology;
  if (!a.count) fail("structure", "expected at least one atom");
  const models: number[] = [];
  const rowsOf = new Map<number, number[]>();
  for (let i = 0; i < a.count; i++) {
    const residue = a.residue[i];
    const model = c.model[r.chain[residue]];
    let rows = rowsOf.get(model);
    if (!rows) {
      rowsOf.set(model, rows = []);
      models.push(model);
    }
    rows.push(i);
  }
  const first = rowsOf.get(models[0])!;
  const key = (i: number): string => {
    const residue = a.residue[i];
    return JSON.stringify([
      a.element[i],
      a.name[i],
      a.altloc[i],
      a.comp?.[i] ?? r.comp[residue],
      r.labelSeq[residue],
      c.labelId[r.chain[residue]],
    ]);
  };
  const reference = first.map(key);
  const frames = models.map((model) => {
    const rows = rowsOf.get(model)!;
    if (rows.length !== first.length) {
      fail(
        `model ${model}`,
        `has ${rows.length} atoms, but model ${
          models[0]
        } has ${first.length}; models must list the same atoms`,
      );
    }
    const positions = new Float32Array(rows.length * 3);
    rows.forEach((row, j) => {
      if (key(row) !== reference[j]) {
        fail(
          `model ${model} row ${row}`,
          `atom ${j} differs from model ${models[0]} row ${first[j]} (${
            reference[j]
          } vs ${key(row)})`,
        );
      }
      positions[j * 3] = data.positions[row * 3];
      positions[j * 3 + 1] = data.positions[row * 3 + 1];
      positions[j * 3 + 2] = data.positions[row * 3 + 2];
    });
    return { positions };
  });
  return createTrajectory({
    atomCount: first.length,
    frames,
    ...(first.length === a.count ? {} : { atomMap: first }),
  });
}
