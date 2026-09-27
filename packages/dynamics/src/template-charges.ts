import {
  activeAtoms,
  attributeColumn,
  BOND_FLAGS,
  residueKey,
  spatialGrid,
  type StructureData,
} from "@molgpu/table";
import { templates } from "./templates.generated.ts";

export interface TemplateChargeOptions {
  readonly his?: "HID" | "HIE" | "HIP";
  /** Template names keyed by `residueKey(data, residueRow)`. */
  readonly residues?: Readonly<Record<string, string>>;
}
export interface ChargeUnmatched {
  readonly comp: string;
  readonly name: string;
  readonly count: number;
  readonly residues: readonly string[];
}
export interface TemplateChargeReport {
  readonly assigned: number;
  readonly netCharge: number;
  readonly unmatched: readonly ChargeUnmatched[];
  /** Template heavy atoms absent from an observed residue, so its net may be fractional. */
  readonly incomplete: readonly {
    residue: string;
    template: string;
    missing: readonly string[];
  }[];
  readonly gaps: readonly {
    before: string;
    after: string;
    distance: number | null;
  }[];
  readonly ions: readonly { residue: string; charge: number; source: string }[];
}
export interface ChargeAssignment<R> {
  readonly values: Float32Array;
  readonly assigned: Uint8Array;
  readonly report: R;
}

// Monatomic ions by wwPDB Chemical Component Dictionary code, with the CCD's
// pdbx_formal_charge (https://www.wwpdb.org/data/ccd). Oxidation states are
// separate codes: FE is Fe(III), FE2 Fe(II); IOD is iodide, while I is
// inosinic acid. Imported nonzero formal charge wins; zero may mean unknown.
const IONS: Readonly<Record<string, number>> = {
  LI: 1,
  NA: 1,
  K: 1,
  RB: 1,
  CS: 1,
  AG: 1,
  CU1: 1,
  F: -1,
  CL: -1,
  BR: -1,
  IOD: -1,
  MG: 2,
  CA: 2,
  SR: 2,
  BA: 2,
  MN: 2,
  FE2: 2,
  CO: 2,
  NI: 2,
  CU: 2,
  ZN: 2,
  CD: 2,
  HG: 2,
  PB: 2,
  FE: 3,
  MN3: 3,
  "3CO": 3,
};
const PROTEIN = new Set([
  "ALA",
  "ARG",
  "ASN",
  "ASP",
  "CYS",
  "GLN",
  "GLU",
  "GLY",
  "HIS",
  "ILE",
  "LEU",
  "LYS",
  "MET",
  "PHE",
  "PRO",
  "SER",
  "THR",
  "TRP",
  "TYR",
  "VAL",
  "HID",
  "HIE",
  "HIP",
  "ASH",
  "GLH",
  "LYN",
  "CYX",
  "CYM",
]);
const nucleic = (comp: string, polymer: string) => {
  if (polymer === "dna") return `D${comp.replace(/^D/, "")}`;
  if (polymer === "rna") return `R${comp.replace(/^R/, "")}`;
  return comp;
};
const distance = (positions: Float32Array, a: number, b: number): number =>
  Math.hypot(
    positions[3 * a] - positions[3 * b],
    positions[3 * a + 1] - positions[3 * b + 1],
    positions[3 * a + 2] - positions[3 * b + 2],
  );
const nameFor = (data: StructureData, row: number) =>
  data.topology.atoms.comp?.[row] ??
    data.topology.residues.comp[data.topology.atoms.residue[row]];

/** Assign AMBER/PDB2PQR charges to known biopolymer components and ions. */
export function templateCharges(
  data: StructureData,
  options: TemplateChargeOptions = {},
): ChargeAssignment<TemplateChargeReport> {
  const { atoms, residues, chains, links } = data.topology;
  const values = new Float32Array(atoms.count),
    assigned = new Uint8Array(atoms.count);
  const rows: number[][] = Array.from({ length: residues.count }, () => []);
  for (let i = 0; i < atoms.count; i++) rows[atoms.residue[i]].push(i);
  const first = new Int32Array(chains.count).fill(-1);
  const last = new Int32Array(chains.count).fill(-1);
  for (let r = 0; r < residues.count; r++) {
    if (residues.polymer[r] === "other") continue;
    const chain = residues.chain[r];
    if (first[chain] < 0) first[chain] = r;
    last[chain] = r;
  }
  const gaps: TemplateChargeReport["gaps"][number][] = [];
  const atomNamed = (r: number, name: string) =>
    rows[r].find((i) => atoms.name[i] === name && !atoms.altloc[i]) ??
      rows[r].find((i) => atoms.name[i] === name);
  for (let r = 1; r < residues.count; r++) {
    const prev = r - 1;
    if (
      residues.chain[r] !== residues.chain[prev] ||
      residues.polymer[r] === "other" || residues.polymer[prev] === "other"
    ) continue;
    const left = atomNamed(
      prev,
      residues.polymer[prev] === "protein" ? "C" : "O3'",
    );
    const right = atomNamed(r, residues.polymer[r] === "protein" ? "N" : "P");
    const d = left === undefined || right === undefined
      ? null
      : distance(data.positions, left, right);
    if (d === null || d > 2) {
      gaps.push({
        before: residueKey(data, prev),
        after: residueKey(data, r),
        distance: d,
      });
    }
  }
  const cystine = new Set<number>();
  for (let k = 0; links && k < links.count; k++) {
    if (!(links.flags[k] & BOND_FLAGS.disulfide)) continue;
    cystine.add(atoms.residue[links.a[k]]);
    cystine.add(atoms.residue[links.b[k]]);
  }
  // Coordinate fallback is only needed where no disulfide annotation exists.
  const sulfur: number[] = [];
  for (let i = 0; i < atoms.count; i++) {
    if (atoms.name[i] === "SG" && nameFor(data, i) === "CYS") sulfur.push(i);
  }
  if (sulfur.length > 1) {
    const model = (i: number) => chains.model[residues.chain[atoms.residue[i]]];
    const grid = spatialGrid(data.positions, sulfur, 2.5, model);
    for (const i of sulfur) {
      grid.near(
        data.positions[3 * i],
        data.positions[3 * i + 1],
        data.positions[3 * i + 2],
        (j) => {
          if (
            j <= i || atoms.residue[i] === atoms.residue[j] ||
            (atoms.altloc[i] && atoms.altloc[j] &&
              atoms.altloc[i] !== atoms.altloc[j])
          ) return;
          if (distance(data.positions, i, j) < 2.5) {
            cystine.add(atoms.residue[i]);
            cystine.add(atoms.residue[j]);
          }
        },
        model(i),
      );
    }
  }
  const ions: TemplateChargeReport["ions"][number][] = [];
  const incomplete: TemplateChargeReport["incomplete"][number][] = [];
  const formal = attributeColumn(data, "formalCharge")?.values;
  for (let r = 0; r < residues.count; r++) {
    const groups = new Map<string, number[]>();
    for (const i of rows[r]) {
      const comp = nameFor(data, i);
      const group = groups.get(comp) ?? [];
      group.push(i);
      groups.set(comp, group);
    }
    for (const [comp, group] of groups) {
      // One atom, possibly repeated across alternate locations.
      if (
        IONS[comp] !== undefined && atoms.element[group[0]] !== 1 &&
        group.every((i) => atoms.name[i] === atoms.name[group[0]]) &&
        new Set(group.map((i) => atoms.altloc[i])).size === group.length
      ) {
        const imported = group.map((i) => formal?.[i] ?? 0).find(Boolean) ?? 0;
        const charge = imported || IONS[comp];
        for (const row of group) {
          values[row] = charge;
          assigned[row] = 1;
        }
        ions.push({
          residue: residueKey(data, r),
          charge,
          source: imported ? "imported:formalCharge" : "ccd:ion",
        });
        continue;
      }
      let key = options.residues?.[residueKey(data, r)] ??
        (comp === "HOH" ? "WAT" : nucleic(comp, residues.polymer[r]));
      if (key === "HIS") {
        const names = new Set(group.map((i) => atoms.name[i]));
        key = options.his ??
          (names.has("HD1") ? names.has("HE2") ? "HIP" : "HID" : "HIE");
      }
      if (key === "CYS" && cystine.has(r)) key = "CYX";
      if (PROTEIN.has(key) && residues.polymer[r] === "protein") {
        const chain = residues.chain[r];
        if (first[chain] === r && templates[`N${key}`]) key = `N${key}`;
        else if (last[chain] === r && templates[`C${key}`]) key = `C${key}`;
      } else if (
        /^[DR][ACGTU]$/.test(key) &&
        residues.polymer[r] !== "other"
      ) {
        const chain = residues.chain[r];
        const hasP = group.some((i) => atoms.name[i] === "P");
        if (
          first[chain] === r && last[chain] === r && !hasP &&
          templates[`${key}N`]
        ) key = `${key}N`;
        else if (first[chain] === r && !hasP && templates[`${key}5`]) {
          key = `${key}5`;
        } else if (last[chain] === r && templates[`${key}3`]) key = `${key}3`;
      }
      const template = templates[key];
      if (!template) continue;
      const allNames = new Set(
        group.map((i) => template.aliases[atoms.name[i]] ?? atoms.name[i]),
      );
      const missing = Object.keys(template.atoms).filter((name) =>
        !template.atoms[name].parent && !allNames.has(name)
      );
      if (missing.length) {
        incomplete.push({
          residue: residueKey(data, r),
          template: key,
          missing,
        });
      }
      const conformers = [
        ...new Set(group.map((i) => atoms.altloc[i]).filter(Boolean)),
      ];
      if (!conformers.length) conformers.push("");
      for (const altloc of conformers) {
        const present = new Map<string, number>();
        for (const i of group) {
          if (atoms.altloc[i] && atoms.altloc[i] !== altloc) continue;
          const name = template.aliases[atoms.name[i]] ?? atoms.name[i];
          if (!present.has(name)) present.set(name, i);
          const entry = template.atoms[name];
          if (entry) {
            values[i] = entry.charge;
            assigned[i] = 1;
          }
        }
        for (const [name, entry] of Object.entries(template.atoms)) {
          if (!entry.parent || present.has(name)) continue;
          const parent = present.get(entry.parent);
          if (parent !== undefined) values[parent] += entry.charge;
        }
      }
    }
  }
  const unmatched = new Map<
    string,
    { comp: string; name: string; count: number; residues: string[] }
  >();
  let netCharge = 0, assignedCount = 0;
  for (const i of activeAtoms(data)) {
    if (assigned[i]) {
      assignedCount++;
      netCharge += values[i];
      continue;
    }
    const comp = nameFor(data, i),
      name = atoms.name[i],
      key = JSON.stringify([comp, name]);
    const item = unmatched.get(key) ?? { comp, name, count: 0, residues: [] };
    item.count++;
    const residue = residueKey(data, atoms.residue[i]);
    if (item.residues.length < 3 && !item.residues.includes(residue)) {
      item.residues.push(residue);
    }
    unmatched.set(key, item);
  }
  return {
    values,
    assigned,
    report: {
      assigned: assignedCount,
      netCharge,
      unmatched: [...unmatched.values()],
      incomplete,
      gaps,
      ions,
    },
  };
}

/** Sum an atom charge column over the first model and primary conformer. */
export function residueNetCharge(
  data: StructureData,
  column = "partialCharge",
): Float32Array {
  const charges = attributeColumn(data, column);
  if (!charges || charges.domain !== "atom") {
    throw new Error(`${column}: expected an atom charge column`);
  }
  const result = new Float32Array(data.topology.residues.count);
  for (const row of activeAtoms(data)) {
    result[data.topology.atoms.residue[row]] += charges.values[row];
  }
  return result;
}
