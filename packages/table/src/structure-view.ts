// Active atom views, stable residue keys, and coordinate bounds.
import type { StructureData, ViewPolicy } from "./structure-types.ts";

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};

/** Explicit view policy; retains all source rows in the underlying dataset.
 * Defaults: first encountered model, residue conformer with largest summed
 * occupancy (lexical tie-break), plus atoms with blank altloc. */
export function activeAtoms(
  data: StructureData,
  policy: ViewPolicy = {},
): Uint32Array {
  const { model = "first", altloc = "primary" } = policy;
  const { atoms: a, residues: r, chains: c } = data.topology;
  if (model !== "first" && model !== "all" && !Number.isInteger(model)) {
    fail("policy.model", "expected first, all, or model id");
  }
  if (!["all", "primary"].includes(altloc)) {
    fail("policy.altloc", "expected all or primary");
  }
  const chosen = model === "first" ? c.model[0] : model;
  if (typeof chosen === "number" && !c.model.includes(chosen)) {
    fail("policy.model", "model not present");
  }
  const scores = new Map<number, Map<string, number>>(),
    conformers = new Map<number, string>();
  if (altloc === "primary") {
    for (let i = 0; i < a.count; i++) {
      if (!a.altloc[i]) continue;
      const residue = a.residue[i];
      let byLabel = scores.get(residue);
      if (!byLabel) scores.set(residue, byLabel = new Map());
      byLabel.set(
        a.altloc[i],
        (byLabel.get(a.altloc[i]) ?? 0) + a.occupancy[i],
      );
    }
    for (const [residue, byLabel] of scores) {
      conformers.set(
        residue,
        [...byLabel].sort(([ka, va], [kb, vb]) =>
          vb - va || (ka < kb ? -1 : ka > kb ? 1 : 0)
        )[0][0],
      );
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < a.count; i++) {
    if (chosen !== "all" && c.model[r.chain[a.residue[i]]] !== chosen) continue;
    if (
      altloc === "primary" && a.altloc[i] &&
      a.altloc[i] !== conformers.get(a.residue[i])
    ) continue;
    indices.push(i);
  }
  return Uint32Array.from(indices);
}

/** Source identifier for joins; includes both author and label namespaces. */
export function residueKey(data: StructureData, row: number): string {
  const { residues: r, chains: c } = data.topology;
  if (!Number.isInteger(row) || row < 0 || row >= r.count) {
    fail("residue", "row out of range");
  }
  const chain = r.chain[row];
  return JSON.stringify([
    c.model[chain],
    c.labelId[chain],
    c.authId[chain],
    r.labelSeq[row],
    r.authSeq[row],
    r.insertionCode[row],
    r.comp[row],
  ]);
}

/** Untransformed coordinate bounds, deliberately separate from camera framing. */
export function coordinateBounds(
  data: StructureData,
  indices?: Uint32Array,
): null | { min: number[]; max: number[]; center: number[] } {
  const n = indices?.length ?? data.topology.atoms.count;
  if (!n) return null;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < n; j++) {
    const i = indices ? indices[j] : j;
    if (!Number.isInteger(i) || i < 0 || i >= data.topology.atoms.count) {
      fail("indices", "atom out of range");
    }
    for (let k = 0; k < 3; k++) {
      const v = data.positions[i * 3 + k];
      min[k] = Math.min(min[k], v);
      max[k] = Math.max(max[k], v);
    }
  }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2) };
}
