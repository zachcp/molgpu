import {
  attributeColumn,
  BOND_FLAGS,
  residueKey,
  type StructureData,
} from "@molgpu/table";
import { type ChargeAssignment, templateCharges } from "./template-charges.ts";

// RDKit GasteigerParams.cpp (2025.09). Gasteiger & Marsili (1980). RDKit's
// sulfoxide/sulfone rows are unused: it charges those S atoms as sp3.
// [electronegativity intercept, linear term, quadratic term].
const PARAMETERS: Readonly<Record<string, readonly [number, number, number]>> =
  {
    "H:*": [7.17, 6.24, -0.56],
    "C:sp3": [7.98, 9.18, 1.88],
    "C:sp2": [8.79, 9.32, 1.51],
    "C:sp": [10.39, 9.45, 0.73],
    "N:sp3": [11.54, 10.82, 1.36],
    "N:sp2": [12.87, 11.15, 0.85],
    "N:sp": [15.68, 11.7, -0.27],
    "O:sp3": [14.18, 12.92, 1.39],
    "O:sp2": [17.07, 13.79, 0.47],
    "F:sp3": [14.66, 13.85, 2.31],
    "Cl:sp3": [11, 9.69, 1.35],
    "Br:sp3": [10.08, 8.47, 1.16],
    "I:sp3": [9.9, 7.96, 0.96],
    "S:sp3": [10.14, 9.13, 1.38],
    "S:sp2": [10.88, 9.49, 1.33],
    "P:sp3": [8.9, 8.24, 0.96],
    "P:sp2": [9.665, 8.53, 0.735],
    "Si:sp3": [7.3, 6.567, 0.657],
    "Si:sp2": [7.905, 6.748, 0.443],
    "Si:sp": [9.065, 7.027, -0.002],
    "B:sp3": [5.98, 6.82, 1.605],
    "B:sp2": [6.42, 6.807, 1.322],
    "Be:sp3": [3.845, 6.755, 3.165],
    "Be:sp2": [4.005, 6.725, 3.035],
    "Mg:sp3": [3.3, 5.587, 2.447],
    "Mg:sp2": [3.565, 5.572, 2.197],
    "Mg:sp": [4.04, 5.472, 1.823],
    "Al:sp3": [5.375, 4.953, 0.867],
    "Al:sp2": [5.795, 5.02, 0.695],
  };
const ELEMENT: Readonly<Record<number, string>> = {
  1: "H",
  5: "B",
  6: "C",
  7: "N",
  8: "O",
  9: "F",
  12: "Mg",
  13: "Al",
  14: "Si",
  15: "P",
  16: "S",
  17: "Cl",
  35: "Br",
  53: "I",
};
// Allowed valences of neutral atoms, lowest first, from RDKit's periodic
// table. A charged atom uses its isoelectronic neighbour (N+ as C, O- as F).
const VALENCES: Readonly<Record<number, readonly number[]>> = {
  1: [1],
  5: [3],
  6: [4],
  7: [3],
  8: [2],
  9: [1],
  14: [4],
  15: [3, 5],
  16: [2, 4, 6],
  17: [1],
  35: [1],
  53: [1, 3, 5],
};
// Valence-shell electrons, for RDKit's bonds-plus-lone-pairs hybridization.
const OUTER: Readonly<Record<number, number>> = {
  1: 1,
  5: 3,
  6: 4,
  7: 5,
  8: 6,
  9: 7,
  12: 2,
  13: 3,
  14: 4,
  15: 5,
  16: 6,
  17: 7,
  35: 7,
  53: 7,
};
export type GasteigerRefusalReason =
  | "template-covered"
  | "polymer-linked"
  | "modified-polymer"
  | "unknown-bond-order"
  | "missing-parameters"
  | "unsupported-valence";
export interface GasteigerRefusal {
  readonly residues: readonly string[];
  readonly reason: GasteigerRefusalReason;
  readonly detail: string;
}
export interface GasteigerReport {
  readonly assigned: number;
  readonly refused: readonly GasteigerRefusal[];
}
export interface GasteigerOptions {
  /** Exclude already assigned atoms; defaults to the AMBER template mask. */
  readonly exclude?: Uint8Array;
  /** RDKit's default is 12 iterations. */
  readonly iterations?: number;
}
type Bond = { order: number; readonly aromatic: boolean };
type Edge = Bond & { readonly a: number; readonly b: number };
type Neighbor = { readonly row: number; readonly bond: Bond };
type Refusal = [GasteigerRefusalReason, string];

/** Charge complete non-polymer connected components with RDKit-style PEOE. */
export function gasteigerCharges(
  data: StructureData,
  options: GasteigerOptions = {},
): ChargeAssignment<GasteigerReport> {
  const { atoms, residues, chains, bonds, links } = data.topology;
  const n = atoms.count;
  const values = new Float32Array(n), assigned = new Uint8Array(n);
  const exclude = options.exclude ?? templateCharges(data).assigned;
  if (exclude.length !== n) {
    throw new Error("exclude mask length differs from atom count");
  }
  const iterations = options.iterations ?? 12;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
    throw new Error("iterations must be an integer from 1 to 100");
  }
  const edges = new Map<string, Edge>();
  const add = (
    a: number,
    b: number,
    order: number,
    aromatic: boolean,
    authoritative = false,
  ) => {
    if (a === b || a >= n || b >= n) return;
    const ra = atoms.residue[a], rb = atoms.residue[b];
    if (chains.model[residues.chain[ra]] !== chains.model[residues.chain[rb]]) {
      return;
    }
    if (
      atoms.altloc[a] && atoms.altloc[b] && atoms.altloc[a] !== atoms.altloc[b]
    ) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const prior = edges.get(key);
    if (!prior || authoritative || (prior.order === 0 && order !== 0)) {
      edges.set(key, { a, b, order, aromatic });
    }
  };
  for (let k = 0; k < bonds.count; k++) {
    if (bonds.flags && !(bonds.flags[k] & BOND_FLAGS.covalent)) continue;
    const order = bonds.source[k] === "inferred" ? 0 : bonds.order[k];
    add(
      bonds.a[k],
      bonds.b[k],
      order,
      order === 4 || !!(bonds.flags && bonds.flags[k] & BOND_FLAGS.aromatic),
    );
  }
  // chem_comp_bond gives Kekulé orders; the aromatic flag only marks
  // conjugation, as RDKit's perceived aromaticity would.
  for (let k = 0; links && k < links.count; k++) {
    if (!(links.flags[k] & BOND_FLAGS.covalent)) continue;
    add(
      links.a[k],
      links.b[k],
      links.order[k],
      links.order[k] === 4 || !!(links.flags[k] & BOND_FLAGS.aromatic),
      true,
    );
  }
  const adjacency: Edge[][] = Array.from({ length: n }, () => []);
  const residueSize = new Uint32Array(residues.count);
  for (let i = 0; i < n; i++) residueSize[atoms.residue[i]]++;
  for (const edge of edges.values()) {
    adjacency[edge.a].push(edge);
    adjacency[edge.b].push(edge);
  }
  const seen = new Uint8Array(n);
  const refused: GasteigerRefusal[] = [];
  const formal = attributeColumn(data, "formalCharge")?.values;
  const refuse = (
    component: number[],
    reason: GasteigerRefusalReason,
    detail: string,
  ) => {
    refused.push({
      residues: [
        ...new Set(component.map((i) => residueKey(data, atoms.residue[i]))),
      ],
      reason,
      detail,
    });
  };
  const solve = (molecule: number[]): Float64Array | Refusal => {
    const m = molecule.length;
    const local = new Map(molecule.map((row, index) => [row, index]));
    const neighbors: Neighbor[][] = molecule.map(() => []);
    for (let p = 0; p < m; p++) {
      for (const edge of adjacency[molecule[p]]) {
        const q = local.get(edge.b);
        if (edge.a !== molecule[p] || q === undefined) continue;
        if (edge.order === 0) {
          return ["unknown-bond-order", "bond order 0 is unknown"];
        }
        const bond = { order: edge.order, aromatic: edge.aromatic };
        neighbors[p].push({ row: q, bond });
        neighbors[q].push({ row: p, bond });
      }
    }
    const z = molecule.map((i) => atoms.element[i]);
    const unknown = z.find((e) => !ELEMENT[e]);
    if (unknown !== undefined) {
      return [
        "missing-parameters",
        `no Gasteiger parameter for atomic number ${unknown}`,
      ];
    }
    const charge = molecule.map((i) => Number(formal?.[i] ?? 0));
    const kekule = kekulize(z, charge, neighbors);
    if (kekule) return kekule;
    const sum = (p: number) =>
      neighbors[p].reduce((s, x) => s + x.bond.order, 0);
    const hydrogens = new Array<number>(m).fill(0);
    for (let p = 0; p < m; p++) {
      if (z[p] === 1) continue;
      const degree = sum(p);
      const allowed = VALENCES[z[p] - charge[p]] ??
        (degree === 0 ? [0] : undefined);
      if (!allowed) {
        return [
          "unsupported-valence",
          `no implicit-H valence for ${ELEMENT[z[p]]}`,
        ];
      }
      const target = allowed.find((v) => v >= degree);
      if (target === undefined || target - degree > 4) {
        return [
          "unsupported-valence",
          `${ELEMENT[z[p]]} has bond-order sum ${degree}`,
        ];
      }
      hydrogens[p] = target - degree;
    }
    // RDKit's conjugation (ConjugHybrid.cpp): aromatic bonds, plus a multiple
    // bond and its neighbour bond on unsaturated first-row atoms.
    const totalDegree = (p: number) => neighbors[p].length + hydrogens[p];
    const candidate = (p: number) => {
      const allowed = VALENCES[z[p]];
      if (z[p] > 10 || !allowed || allowed[0] <= 1 || totalDegree(p) > 3) {
        return false;
      }
      if (!charge[p] && sum(p) + hydrogens[p] > allowed[0]) return false;
      const lone = Math.max(OUTER[z[p]] - allowed[0] - charge[p], 0);
      return allowed[0] - totalDegree(p) + lone > 0;
    };
    const conjugated = new Set<Bond>();
    for (let p = 0; p < m; p++) {
      for (const x of neighbors[p]) if (x.bond.aromatic) conjugated.add(x.bond);
    }
    for (let p = 0; p < m; p++) {
      if (!candidate(p) || totalDegree(p) < 2) continue;
      for (const first of neighbors[p]) {
        if (first.bond.order < 2 && !first.bond.aromatic) continue;
        for (const other of neighbors[p]) {
          if (
            other === first || totalDegree(other.row) > 3 ||
            !candidate(other.row)
          ) continue;
          conjugated.add(first.bond);
          conjugated.add(other.bond);
        }
      }
    }
    const params: (readonly [number, number, number])[] = [];
    for (let p = 0; p < m; p++) {
      const symbol = ELEMENT[z[p]];
      let mode = "*";
      if (z[p] !== 1) {
        // RDKit numBondsPlusLonePairs hybridization.
        const lone = Math.max(
          0,
          Math.floor((OUTER[z[p]] - sum(p) - hydrogens[p] - charge[p]) / 2),
        );
        const orbitals = totalDegree(p) + lone;
        mode = orbitals === 2 ? "sp" : orbitals === 3 ||
            (orbitals === 4 && totalDegree(p) <= 3 &&
              neighbors[p].some((x) => conjugated.has(x.bond)))
          ? "sp2"
          : "sp3";
      }
      const parameter = PARAMETERS[`${symbol}:${mode}`];
      if (!parameter) {
        return [
          "missing-parameters",
          `no Gasteiger parameter for ${symbol}:${mode}`,
        ];
      }
      params.push(parameter);
    }
    const q = charge.slice();
    for (let p = 0; p < m; p++) {
      if (!q[p]) continue;
      const same = new Set([p]);
      for (const first of neighbors[p]) {
        if (!conjugated.has(first.bond)) continue;
        for (const second of neighbors[first.row]) {
          if (
            second.row !== p && conjugated.has(second.bond) &&
            z[p] === z[second.row]
          ) same.add(second.row);
        }
      }
      const total = [...same].reduce((s, row) => s + q[row], 0);
      for (const row of same) q[row] = total / same.size;
    }
    const hCharge = new Float64Array(m);
    const ionX = params.map((x, p) => z[p] === 1 ? 20.02 : x[0] + x[1] + x[2]);
    const energy = new Float64Array(m);
    const hParam = PARAMETERS["H:*"];
    let damp = 0.5;
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let p = 0; p < m; p++) {
        const parameter = params[p];
        energy[p] = parameter[0] + q[p] * (parameter[1] + parameter[2] * q[p]);
      }
      for (let p = 0; p < m; p++) {
        let delta = 0;
        for (const neighbor of neighbors[p]) {
          const j = neighbor.row, dx = energy[j] - energy[p];
          delta += dx / (dx < 0 ? ionX[j] : ionX[p]);
        }
        const count = hydrogens[p];
        if (count) {
          const h = hCharge[p] / count;
          const dx = hParam[0] + h * (hParam[1] + hParam[2] * h) - energy[p];
          const hDelta = dx / (dx < 0 ? 20.02 : ionX[p]);
          delta += count * hDelta;
          hCharge[p] -= count * hDelta * damp;
        }
        q[p] += damp * delta;
      }
      damp *= 0.5;
    }
    return Float64Array.from(q, (x, p) => x + hCharge[p]);
  };
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const component: number[] = [], queue = [start];
    seen[start] = 1;
    for (let p = 0; p < queue.length; p++) {
      const i = queue[p];
      component.push(i);
      for (const edge of adjacency[i]) {
        const j = edge.a === i ? edge.b : edge.a;
        if (!seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    // Protein and nucleic chains are explicitly outside this method. A
    // modified residue within one is named, even if it has no covalent link.
    const polymer = component.filter((i) =>
      residues.polymer[atoms.residue[i]] !== "other"
    );
    if (polymer.length) {
      if (polymer.length !== component.length) {
        refuse(
          component,
          "polymer-linked",
          "component contains polymer and het atoms",
        );
      } else if (polymer.some((i) => !exclude[i])) {
        refuse(
          component,
          "modified-polymer",
          "polymer component is outside templates",
        );
      }
      continue;
    }
    // Water and ions the templates already charged are not refusals.
    const covered = component.filter((i) => exclude[i]).length;
    if (covered === component.length) continue;
    if (covered) {
      refuse(
        component,
        "template-covered",
        "a template already assigned part of this component",
      );
      continue;
    }
    const countByResidue = new Map<number, number>();
    for (const i of component) {
      const r = atoms.residue[i];
      countByResidue.set(r, (countByResidue.get(r) ?? 0) + 1);
    }
    if ([...countByResidue].some(([r, count]) => count < residueSize[r])) {
      refuse(
        component,
        "unknown-bond-order",
        "residue has disconnected atoms or missing bonds",
      );
      continue;
    }
    // Alternate locations share one component; each conformer is its own
    // molecule, and atoms common to all conformers get identical charges.
    const altlocs = [
      ...new Set(component.map((i) => atoms.altloc[i]).filter(Boolean)),
    ];
    const solved: [number[], Float64Array][] = [];
    let error: Refusal | undefined;
    for (const altloc of altlocs.length ? altlocs : [""]) {
      const molecule = component.filter((i) =>
        !atoms.altloc[i] || atoms.altloc[i] === altloc
      );
      const result = solve(molecule);
      if (Array.isArray(result)) {
        error = result;
        break;
      }
      solved.push([molecule, result]);
    }
    if (error) {
      refuse(component, ...error);
      continue;
    }
    for (const [molecule, result] of solved) {
      for (let p = 0; p < molecule.length; p++) {
        values[molecule[p]] = result[p];
        assigned[molecule[p]] = 1;
      }
    }
  }
  return {
    values,
    assigned,
    report: { assigned: assigned.reduce((a, b) => a + b, 0), refused },
  };
}

/**
 * Give order-4 (aromatic) bonds Kekulé orders in place. Carbon and charged
 * ring atoms need one double bond; a neutral two-connected N or P may carry
 * the ring hydrogen instead (pyrrole). The fewest such hydrogens must have a
 * unique placement, otherwise the tautomer is unknown and nothing is guessed.
 */
function kekulize(
  z: readonly number[],
  charge: readonly number[],
  neighbors: readonly Neighbor[][],
): Refusal | undefined {
  const m = z.length;
  const ring = neighbors.map((list) => list.filter((x) => x.bond.order === 4));
  if (!ring.some((list) => list.length)) return undefined;
  // 0 no double bond, 1 needs one, 2 needs one or a hydrogen.
  const role = new Uint8Array(m);
  for (let p = 0; p < m; p++) {
    if (!ring[p].length) continue;
    const allowed = VALENCES[z[p] - charge[p]];
    if (!allowed) {
      return [
        "unsupported-valence",
        `no aromatic valence for ${ELEMENT[z[p]]}`,
      ];
    }
    const single = neighbors[p].reduce(
      (s, x) => s + (x.bond.order === 4 ? 1 : x.bond.order),
      0,
    );
    const spare = allowed[0] - single;
    if (spare <= 0) continue;
    role[p] = spare === 1 && !charge[p] && (z[p] === 7 || z[p] === 15) &&
        ring[p].length === 2
      ? 2
      : 1;
  }
  const mate = new Int32Array(m).fill(-1);
  let best: Int32Array | undefined, bestKey = "", fewest = Infinity;
  let ambiguous = false, steps = 0;
  const visit = (p: number, hydrogens: number[]): boolean => {
    if (++steps > 100_000) return false;
    while (p < m && (!role[p] || mate[p] !== -1)) p++;
    if (hydrogens.length > fewest) return true;
    if (p === m) {
      const key = hydrogens.join();
      if (hydrogens.length < fewest) {
        fewest = hydrogens.length;
        best = mate.slice();
        bestKey = key;
        ambiguous = false;
      } else if (key !== bestKey) ambiguous = true;
      return true;
    }
    for (const x of ring[p]) {
      if (!role[x.row] || mate[x.row] !== -1) continue;
      mate[p] = x.row;
      mate[x.row] = p;
      const ok = visit(p + 1, hydrogens);
      mate[p] = mate[x.row] = -1;
      if (!ok) return false;
    }
    if (role[p] === 2) {
      mate[p] = -2;
      const ok = visit(p + 1, [...hydrogens, p]);
      mate[p] = -1;
      if (!ok) return false;
    }
    return true;
  };
  if (!visit(0, [])) {
    return ["unknown-bond-order", "aromatic system is too large to kekulize"];
  }
  if (!best) {
    return ["unknown-bond-order", "aromatic bonds have no Kekulé structure"];
  }
  if (ambiguous) {
    return [
      "unknown-bond-order",
      "aromatic hydrogen position is ambiguous without explicit hydrogens",
    ];
  }
  for (let p = 0; p < m; p++) {
    for (const x of ring[p]) x.bond.order = best[p] === x.row ? 2 : 1;
  }
  return undefined;
}
