// DSSP secondary-structure assignment, ported from Mol* 5.11.0
// (mol-model-props/computed/secondary-structure/dssp.js and dssp/*), MIT
// License, Copyright (c) 2019-2026 mol* contributors: Sebastian Bittrich,
// Alexander Rose, David Sehnal. Kabsch & Sander (1983) with Mol*'s defaults
// (oldDefinition and oldOrdering true: DSSP 2.x turns/helices, alpha helices
// preferred over 3-10). No polyproline (P) code: Mol* has none.
//
// This algorithm traverses structure rows (chains,
// residues and named backbone atoms).
//
// A unit is one chain in one model, as Mol*'s atomic units are: H-bonds
// between chains are not searched (Mol*'s own TODO), so inter-chain sheets are
// not found. Preserved Mol* behaviour: list neighbours across sequence gaps, the OXT acceptor skip,
// the energy operation order and -9.9 cap, the inclusive 9 Å CA search, the
// CA–N(i+1) 2.5 Å bend check, bridges tested only for i !== j, and ladder
// last-wins with the nextLadder === 0 sentinel. Fixed: Mol*'s assignBends reads
// CA through the unit-list index instead of the residue, so Mol* only assigns S
// in a model's first unit; this port reads the residue's CA. Mol*'s dihedral
// angles are computed but unused and are not ported.
import type { StructureData } from "./structure-types.ts";
import { spatialGrid } from "./spatial-grid.ts";
import { attributeColumn, withAttributes } from "./attributes.ts";
import { activeAtoms } from "./structure-view.ts";

// Mol*'s DSSPType flags.
const F_H = 1, F_B = 2, F_E = 4, F_G = 8, F_I = 16, F_S = 32, F_T = 64;
const F_T3 = 128, F_T4 = 256, F_T5 = 512;
const F_T3S = 1024, F_T4S = 2048, F_T5S = 4096;
const TURN = [F_T3S, F_T4S, F_T5S, F_T3, F_T4, F_T5];
const HELIX = [0, 0, 0, F_G, F_H, F_I];

// ssCode values (SS_CODES order).
const CODE_H = 1, CODE_B = 2, CODE_E = 3, CODE_G = 4, CODE_I = 5;
const CODE_T = 6, CODE_S = 7;

const CA_MAX_DIST = 9.0;
const Q = -27.888; // -332 * 0.42 * 0.20
const HBOND_CUTOFF = -0.5;
const HBOND_MINIMAL = -9.9;
const PI_DIV_180 = Math.PI / 180;

const PARALLEL = 0, ANTI_PARALLEL = 1;
interface Bridge {
  readonly partner1: number;
  readonly partner2: number;
  readonly type: number;
}
interface Ladder {
  previousLadder: number;
  nextLadder: number;
  firstStart: number;
  firstEnd: number;
  secondStart: number;
  secondEnd: number;
  type: number;
}
const bridge = (p1: number, p2: number, type: number): Bridge => ({
  partner1: Math.min(p1, p2),
  partner2: Math.max(p1, p2),
  type,
});

/** One unit's residues (list order) and their backbone atom rows (-1 absent). */
interface Unit {
  readonly residues: number[];
  readonly n: Int32Array;
  readonly ca: Int32Array;
  readonly c: Int32Array;
  readonly o: Int32Array;
  readonly h: Int32Array;
  readonly oxt: Uint8Array;
}

/**
 * DSSP codes per residue (the `ssCode` column's values): 0 coil, H, B, E, G,
 * I, T, S. Non-protein residues and residues without rows are 0.
 */
export function dssp(
  data: StructureData,
  options: {
    /** Atom rows to read, ascending. Defaults to every model with primary
     * altlocs. With all altlocs, the first conformer in file order wins. */
    readonly rows?: ArrayLike<number>;
  } = {},
): Uint8Array {
  const rows = options.rows ?? activeAtoms(data, { model: "all" });
  const { atoms, residues } = data.topology;
  const P = data.positions;
  // First row per backbone name, per protein residue that has rows.
  const first = new Map<number, Map<string, number>>();
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k], r = atoms.residue[i];
    if (residues.polymer[r] !== "protein") continue;
    let names = first.get(r);
    if (!names) first.set(r, names = new Map());
    const name = atoms.name[i];
    if (!names.has(name)) names.set(name, i);
  }
  // Units: one chain in one model, residues in label_seq order.
  const byChain = new Map<number, number[]>();
  for (const r of [...first.keys()].sort((a, b) => a - b)) {
    const chain = residues.chain[r];
    let list = byChain.get(chain);
    if (!list) byChain.set(chain, list = []);
    list.push(r);
  }
  const codes = new Uint8Array(residues.count);
  for (const list of byChain.values()) {
    list.sort((a, b) => residues.labelSeq[a] - residues.labelSeq[b] || a - b);
    const m = list.length;
    const at = (name: string) =>
      Int32Array.from(list, (r) => first.get(r)!.get(name) ?? -1);
    const unit: Unit = {
      residues: list,
      n: at("N"),
      ca: at("CA"),
      c: at("C"),
      o: at("O"),
      h: at("H"),
      oxt: Uint8Array.from(list, (r) => first.get(r)!.has("OXT") ? 1 : 0),
    };
    const flags = assignUnit(unit, P, m);
    for (let i = 0; i < m; i++) codes[list[i]] = residueCode(flags[i]);
  }
  return codes;
}

/**
 * Set `ssCode` by Mol*'s secondary-structure modes. `"auto"` (the default)
 * keeps an imported or user column and runs DSSP when the column is
 * absent or `default` (a file without annotation); `"dssp"` always runs it;
 * `"model"` returns `data` unchanged. Computed codes carry provenance
 * `computed:dssp`.
 */
export function withSecondaryStructure(
  data: StructureData,
  options: {
    readonly rows?: ArrayLike<number>;
    readonly mode?: "auto" | "dssp" | "model";
  } = {},
): StructureData {
  const { mode = "auto" } = options;
  if (!["auto", "dssp", "model"].includes(mode)) {
    throw new TypeError(
      "withSecondaryStructure: mode must be auto, dssp or model",
    );
  }
  if (mode === "model") return data;
  const current = attributeColumn(data, "ssCode");
  if (mode === "auto" && current && current.provenance !== "default") {
    return data;
  }
  return withAttributes(data, {
    ssCode: {
      domain: "residue",
      kind: "code",
      provenance: "computed:dssp",
      values: dssp(data, options),
    },
  });
}

/** Mol*'s getOriginalResidueFlag priority: H, E, B, G, I, T, S. */
function residueCode(f: number): number {
  if (f & F_H) return CODE_H;
  if (f & F_E) return CODE_E;
  if (f & F_B) return CODE_B;
  if (f & F_G) return CODE_G;
  if (f & F_I) return CODE_I;
  if (f & F_T) return CODE_T;
  if (f & F_S) return CODE_S;
  return 0;
}

const dist = (P: Float32Array, a: number, b: readonly number[]): number => {
  const dx = P[a * 3] - b[0],
    dy = P[a * 3 + 1] - b[1],
    dz = P[a * 3 + 2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};
const xyz = (P: Float32Array, i: number): number[] =>
  i < 0 ? [NaN, NaN, NaN] : [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

function assignUnit(unit: Unit, P: Float32Array, m: number): Uint32Array {
  const hbonds = backboneHbonds(unit, P, m);
  const has = (i: number, j: number): boolean =>
    i >= 0 && i < m && hbonds[i].includes(j);
  const flags = new Uint32Array(m);

  // Turns (oldDefinition).
  for (let idx = 0; idx < 3; idx++) {
    for (let i = 0; i < m - 1; ++i) {
      if (has(i, i + idx + 3)) {
        flags[i] |= TURN[idx + 3] | TURN[idx];
        for (let k = 1; k < idx + 3; ++k) {
          flags[i + k] |= TURN[idx + 3] | F_T;
        }
      }
    }
  }

  // Helices (oldOrdering: alpha, then 3-10 yielding to alpha, then pi).
  for (const n of [4, 3, 5]) {
    for (let i = 1; i < m - n; i++) {
      const fI = flags[i], fI1 = flags[i - 1], fI2 = flags[i + 1];
      if (
        (n === 3 && ((fI & F_H) !== 0 || (fI2 & F_H) !== 0)) ||
        (n === 5 &&
          ((fI & (F_H | F_G)) !== 0 || (fI2 & (F_H | F_G)) !== 0))
      ) continue;
      if (
        (fI & TURN[n]) !== 0 && (fI & TURN[n - 3]) !== 0 &&
        (fI1 & TURN[n]) !== 0 && (fI1 & TURN[n - 3]) !== 0
      ) {
        for (let k = 0; k < n; k++) flags[i + k] |= HELIX[n];
      }
    }
  }

  // Bends. A missing atom reads NaN, which never fails the peptide check.
  bends: for (let i = 2; i < m - 2; i++) {
    for (let k = 0; k < 4; k++) {
      const index = i + k - 2;
      const ca = xyz(P, unit.ca[index]), n = xyz(P, unit.n[index + 1]);
      const dx = ca[0] - n[0], dy = ca[1] - n[1], dz = ca[2] - n[2];
      if (dx * dx + dy * dy + dz * dz > 6.25) continue bends;
    }
    const prev2 = xyz(P, unit.ca[i - 2]),
      ca = xyz(P, unit.ca[i]),
      next2 = xyz(P, unit.ca[i + 2]);
    const a = [prev2[0] - ca[0], prev2[1] - ca[1], prev2[2] - ca[2]];
    const b = [ca[0] - next2[0], ca[1] - next2[1], ca[2] - next2[2]];
    const angle = vecAngle(a, b) / PI_DIV_180;
    if (angle && angle > 70.00) flags[i] |= F_S;
  }

  // Bridges, over H-bond edges k -> l with k <= l.
  const bridges: Bridge[] = [];
  for (let k = 0; k < m; ++k) {
    for (const l of hbonds[k]) {
      if (k > l) continue;
      let i = k + 1, j = l; // parallel: Hbond(i-1, j) and Hbond(j, i+1)
      if (i !== j && has(j, i + 1)) {
        flags[i] |= F_B;
        flags[j] |= F_B;
        bridges.push(bridge(i, j, PARALLEL));
      }
      i = k;
      j = l - 1; // parallel: Hbond(j-1, i) and Hbond(i, j+1)
      if (i !== j && has(j - 1, i)) {
        flags[i] |= F_B;
        flags[j] |= F_B;
        bridges.push(bridge(j, i, PARALLEL));
      }
      i = k;
      j = l; // antiparallel: Hbond(i, j) and Hbond(j, i)
      if (i !== j && has(j, i)) {
        flags[i] |= F_B;
        flags[j] |= F_B;
        bridges.push(bridge(j, i, ANTI_PARALLEL));
      }
      i = k + 1;
      j = l - 1; // antiparallel: Hbond(i-1, j+1) and Hbond(j-1, i+1)
      if (i !== j && has(j - 1, i + 1)) {
        flags[i] |= F_B;
        flags[j] |= F_B;
        bridges.push(bridge(j, i, ANTI_PARALLEL));
      }
    }
  }
  // Stable, as Array.prototype.sort is.
  bridges.sort((a, b) =>
    a.partner1 > b.partner1 ? 1 : a.partner1 < b.partner1 ? -1 : 0
  );

  assignSheets(flags, assignLadders(bridges));
  return flags;
}

function vecAngle(a: readonly number[], b: readonly number[]): number {
  const denominator = Math.sqrt(
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) *
      (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]),
  );
  if (denominator === 0) return Math.PI / 2;
  const theta = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / denominator;
  return Math.acos(Math.max(-1, Math.min(1, theta)));
}

/**
 * Acceptor list index -> donor list indices (ascending) with Kabsch-Sander
 * energy <= -0.5 kcal/mol, searched over CA atoms within 9 Å.
 */
function backboneHbonds(unit: Unit, P: Float32Array, m: number): number[][] {
  const out = Array.from({ length: m }, () => [] as number[]);
  const caRows: number[] = [], listOf = new Map<number, number>();
  for (let i = 0; i < m; i++) {
    if (unit.ca[i] < 0) continue;
    caRows.push(unit.ca[i]);
    listOf.set(unit.ca[i], i);
  }
  if (!caRows.length) return out;
  const grid = spatialGrid(P, caRows, CA_MAX_DIST);
  const near: number[] = [];
  const hPos = [0, 0, 0];
  for (let i = 0; i < m; ++i) {
    const o = unit.o[i], c = unit.c[i], ca = unit.ca[i];
    if (o === -1 || c === -1) continue;
    if (unit.oxt[i]) continue; // C-terminal residue is no acceptor
    if (ca === -1) continue; // Mol*'s CA reads NaN and finds nothing
    const caPos = xyz(P, ca);
    near.length = 0;
    grid.near(caPos[0], caPos[1], caPos[2], (row) => {
      const dx = P[row * 3] - caPos[0],
        dy = P[row * 3 + 1] - caPos[1],
        dz = P[row * 3 + 2] - caPos[2];
      if (dx * dx + dy * dy + dz * dz <= CA_MAX_DIST * CA_MAX_DIST) {
        near.push(listOf.get(row)!);
      }
    });
    near.sort((a, b) => a - b);
    for (const j of near) {
      if (j === i || j - 1 === i || j + 1 === i) continue;
      const n = unit.n[j];
      if (n === -1) continue;
      const nPos = xyz(P, n);
      if (unit.h[j] === -1) {
        // Place H from the previous listed residue's C=O.
        if (j === 0) continue;
        const oPrev = unit.o[j - 1], cPrev = unit.c[j - 1];
        if (oPrev === -1 || cPrev === -1) continue;
        const op = xyz(P, oPrev), cp = xyz(P, cPrev);
        const d = dist(P, oPrev, cp);
        hPos[0] = nPos[0] + (cp[0] - op[0]) * (1 / d);
        hPos[1] = nPos[1] + (cp[1] - op[1]) * (1 / d);
        hPos[2] = nPos[2] + (cp[2] - op[2]) * (1 / d);
      } else {
        const h = xyz(P, unit.h[j]);
        hPos[0] = h[0];
        hPos[1] = h[1];
        hPos[2] = h[2];
      }
      const distOH = dist(P, o, hPos), distCH = dist(P, c, hPos);
      const distCN = dist(P, c, nPos), distON = dist(P, o, nPos);
      const e1 = Q / distOH - Q / distCH;
      const e2 = Q / distCN - Q / distON;
      let e = e1 + e2;
      if (e < HBOND_MINIMAL) e = HBOND_MINIMAL;
      if (e > HBOND_CUTOFF) continue;
      out[i].push(j);
    }
  }
  return out;
}

function shouldExtendLadder(ladder: Ladder, b: Bridge): boolean {
  if (b.type !== ladder.type) return false;
  if (b.partner1 !== ladder.firstEnd + 1) return false;
  if (b.type === PARALLEL) return b.partner2 === ladder.secondEnd + 1;
  return b.partner2 === ladder.secondStart - 1;
}
function bulgeCriterion2(l1: Ladder, l2: Ladder): boolean {
  return l2.secondStart - l1.secondEnd > 0 &&
    ((l2.secondStart - l1.secondEnd < 6 && l2.firstStart - l1.firstEnd < 3) ||
      l2.secondStart - l1.secondEnd < 3);
}
function resemblesBulge(l1: Ladder, l2: Ladder): boolean {
  if (
    !(l1.type === l2.type && l2.firstStart - l1.firstEnd < 6 &&
      l1.firstStart < l2.firstStart && l2.nextLadder === 0)
  ) return false;
  return l1.type === PARALLEL
    ? bulgeCriterion2(l1, l2)
    : bulgeCriterion2(l2, l1);
}

function assignLadders(bridges: readonly Bridge[]): Ladder[] {
  const ladders: Ladder[] = [];
  for (const b of bridges) {
    let found = false;
    for (const ladder of ladders) {
      if (shouldExtendLadder(ladder, b)) {
        found = true;
        ladder.firstEnd++;
        if (b.type === PARALLEL) ladder.secondEnd++;
        else ladder.secondStart--;
      }
    }
    if (!found) {
      ladders.push({
        previousLadder: 0,
        nextLadder: 0,
        firstStart: b.partner1,
        firstEnd: b.partner1,
        secondStart: b.partner2,
        secondEnd: b.partner2,
        type: b.type,
      });
    }
  }
  for (let i1 = 0; i1 < ladders.length; i1++) {
    for (let i2 = i1; i2 < ladders.length; i2++) {
      if (resemblesBulge(ladders[i1], ladders[i2])) {
        ladders[i1].nextLadder = i2;
        ladders[i2].previousLadder = i1;
      }
    }
  }
  return ladders;
}

const isHelix = (f: number): boolean => (f & (F_G | F_H | F_I)) !== 0;

function assignSheets(flags: Uint32Array, ladders: readonly Ladder[]): void {
  for (const ladder of ladders) {
    for (let l = ladder.firstStart; l <= ladder.firstEnd; l++) {
      const diff = ladder.firstStart - l;
      const l2 = ladder.secondStart - diff;
      if (ladder.firstStart !== ladder.firstEnd) {
        flags[l] |= F_E;
        flags[l2] |= F_E;
      } else {
        if (!isHelix(flags[l]) && (flags[l] & F_E) !== 0) flags[l] |= F_B;
        if (!isHelix(flags[l2]) && (flags[l2] & F_E) !== 0) flags[l2] |= F_B;
      }
    }
    if (ladder.nextLadder === 0) continue;
    const con = ladders[ladder.nextLadder];
    for (let l = ladder.firstStart; l <= con.firstEnd; l++) flags[l] |= F_E;
    if (ladder.type === PARALLEL) {
      for (let l = ladder.secondStart; l <= con.secondEnd; l++) flags[l] |= F_E;
    } else {
      for (let l = con.secondEnd; l <= ladder.secondStart; l++) flags[l] |= F_E;
    }
  }
}
