import {
  attributeColumn,
  BOND_FLAGS,
  residueKey,
  type StructureData,
} from "@molgpu/table";
import { type ChargeAssignment, templateCharges } from "./template-charges.ts";

// RDKit Release_2025_09_5, GasteigerParams.cpp. Gasteiger & Marsili (1980).
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
    "S:so": [10.14, 9.13, 1.38],
    "S:so2": [12, 10.81, 1.2],
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
const VALENCE: Readonly<Record<number, number>> = {
  5: 3,
  6: 4,
  7: 3,
  8: 2,
  9: 1,
  14: 4,
  15: 3,
  16: 2,
  17: 1,
  35: 1,
  53: 1,
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
type Edge = { a: number; b: number; order: number };

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
  const add = (a: number, b: number, order: number, authoritative = false) => {
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
      edges.set(key, { a, b, order });
    }
  };
  for (let k = 0; k < bonds.count; k++) {
    if (bonds.flags && !(bonds.flags[k] & BOND_FLAGS.covalent)) continue;
    add(
      bonds.a[k],
      bonds.b[k],
      bonds.source[k] === "inferred" ? 0 : bonds.order[k],
    );
  }
  for (let k = 0; links && k < links.count; k++) {
    if (!(links.flags[k] & BOND_FLAGS.covalent)) continue;
    add(
      links.a[k],
      links.b[k],
      links.flags[k] & BOND_FLAGS.aromatic ? 4 : links.order[k],
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
    if (component.some((i) => exclude[i])) {
      refuse(
        component,
        "template-covered",
        "a template already assigned this component",
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
    const local = new Map(component.map((row, index) => [row, index]));
    const componentEdges = component.flatMap((i) =>
      adjacency[i].filter((edge) => edge.a === i && local.has(edge.b))
    );
    if (componentEdges.some((edge) => edge.order === 0)) {
      refuse(component, "unknown-bond-order", "bond order 0 is unknown");
      continue;
    }
    const unknownElement = component.find((i) => !ELEMENT[atoms.element[i]]);
    if (unknownElement !== undefined) {
      refuse(
        component,
        "missing-parameters",
        `no Gasteiger parameter for atomic number ${
          atoms.element[unknownElement]
        }`,
      );
      continue;
    }
    const neighbors: { row: number; order: number }[][] = component.map(
      () => [],
    );
    for (const edge of componentEdges) {
      const a = local.get(edge.a)!, b = local.get(edge.b)!;
      neighbors[a].push({ row: b, order: edge.order });
      neighbors[b].push({ row: a, order: edge.order });
    }
    const params: (readonly [number, number, number])[] = [];
    const hydrogens: number[] = [];
    let error: [GasteigerRefusalReason, string] | undefined;
    for (let p = 0; p < component.length; p++) {
      const i = component[p], z = atoms.element[i], symbol = ELEMENT[z];
      const degree = neighbors[p].reduce(
        (s, x) => s + (x.order === 4 ? 1.5 : x.order),
        0,
      );
      const charge = formal?.[i] ?? 0;
      let h = 0;
      if (z !== 1) {
        const valence = VALENCE[z];
        if (valence === undefined && symbol) {
          error = [
            "unsupported-valence",
            `no implicit-H valence for ${symbol}`,
          ];
          break;
        }
        if (valence !== undefined) {
          const target = (z === 15 && degree > 3
            ? 5
            : z === 16 && degree > 2
            ? 6
            : valence) +
            ([6, 7, 8].includes(z) ? charge : 0);
          h = Math.max(0, Math.round(target - degree));
          if (h > 4 || Math.abs(degree + h - target) > 0.2) {
            error = [
              "unsupported-valence",
              `${symbol} has bond-order sum ${degree}`,
            ];
            break;
          }
        }
      }
      const orders = neighbors[p].map((x) => x.order);
      let mode = z === 1 ? "*" : orders.includes(3) ||
          orders.filter((x) => x === 2).length >= 2
        ? "sp"
        : orders.some((x) => x === 2 || x === 4)
        ? "sp2"
        : "sp3";
      if (
        (z === 7 || z === 8) && mode === "sp3" &&
        neighbors[p].some((bond) =>
          bond.order === 1 &&
          neighbors[bond.row].some((other) =>
            other.row !== p && (other.order === 2 || other.order === 4)
          )
        )
      ) mode = "sp2";
      if (z === 16 && mode === "sp3") {
        const oxygens = neighbors[p].filter((x) =>
          atoms.element[component[x.row]] === 8
        ).length;
        if (oxygens === 1) mode = "so";
        if (oxygens === 2) mode = "so2";
      }
      const parameter = PARAMETERS[`${symbol}:${mode}`];
      if (!parameter) {
        error = [
          "missing-parameters",
          `no Gasteiger parameter for ${symbol ?? z}:${mode}`,
        ];
        break;
      }
      params.push(parameter);
      hydrogens.push(h);
    }
    if (error) {
      refuse(component, ...error);
      continue;
    }
    const q = component.map((i) => Number(formal?.[i] ?? 0));
    const conjugated = (a: number, b: number, order: number) =>
      order === 2 || order === 4 ||
      neighbors[a].some((x) =>
        x.row !== b && (x.order === 2 || x.order === 4)
      ) ||
      neighbors[b].some((x) => x.row !== a && (x.order === 2 || x.order === 4));
    for (let p = 0; p < component.length; p++) {
      if (!q[p]) continue;
      const same = new Set([p]);
      for (const first of neighbors[p]) {
        if (!conjugated(p, first.row, first.order)) continue;
        for (const second of neighbors[first.row]) {
          if (
            second.row === p ||
            !conjugated(first.row, second.row, second.order)
          ) continue;
          if (
            atoms.element[component[p]] === atoms.element[component[second.row]]
          ) {
            same.add(second.row);
          }
        }
      }
      const total = [...same].reduce((sum, row) => sum + q[row], 0);
      for (const row of same) q[row] = total / same.size;
    }
    const hCharge = new Float64Array(component.length);
    const ionX = params.map((p, i) =>
      atoms.element[component[i]] === 1 ? 20.02 : p[0] + p[1] + p[2]
    );
    const energy = new Float64Array(component.length);
    const hParam = PARAMETERS["H:*"];
    let damp = 0.5;
    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let p = 0; p < component.length; p++) {
        const parameter = params[p];
        energy[p] = parameter[0] + q[p] * (parameter[1] + parameter[2] * q[p]);
      }
      for (let p = 0; p < component.length; p++) {
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
    for (let p = 0; p < component.length; p++) {
      values[component[p]] = q[p] + hCharge[p];
      assigned[component[p]] = 1;
    }
  }
  return {
    values,
    assigned,
    report: { assigned: assigned.reduce((a, b) => a + b, 0), refused },
  };
}
