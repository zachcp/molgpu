// Display radii and inferred bond topology.
import type { BondPolicy, Bonds, StructureData } from "./structure-types.ts";
import { isStructureIdentity } from "./structure.ts";
import { spatialGrid } from "./spatial-grid.ts";

type Identity = StructureData["identity"];
const radiiCache = new WeakMap<Identity, Float32Array>();
const inferredBondCache = new WeakMap<StructureData, Map<string, Bonds>>();
const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};
const finite = (value: number, path: string): void => {
  if (!Number.isFinite(value)) fail(path, "expected finite number");
};

/** Bond type bits for `bonds.flags` and `links.flags`, with Mol*'s BondType values. */
export const BOND_FLAGS: Readonly<{
  covalent: 1;
  metallic: 2;
  hydrogen: 4;
  disulfide: 8;
  aromatic: 16;
  computed: 32;
}> = Object.freeze({
  covalent: 1,
  metallic: 2,
  hydrogen: 4,
  disulfide: 8,
  aromatic: 16,
  computed: 32,
});

// Van der Waals radii (Angstrom) for the common biomolecular elements.
const VDW_RADIUS: Readonly<Record<number, number>> = {
  1: 1.1,
  6: 1.7,
  7: 1.55,
  8: 1.52,
  15: 1.8,
  16: 1.8,
  26: 2.05,
  34: 1.9,
};
const DEFAULT_VDW_RADIUS = 1.7;

/** Van der Waals radius in Angstrom for an atomic number; 1.7 when unlisted. */
export function elementRadius(atomicNumber: number): number {
  return VDW_RADIUS[atomicNumber] ?? DEFAULT_VDW_RADIUS;
}

/** Per-atom display radii in Angstrom: the dataset's `atoms.radius` column when
 * present, else element defaults. Topology-only, so the result is shared by
 * every coordinate revision of one dataset. Read-only by contract. */
export function atomRadii(data: StructureData): Float32Array {
  if (!isStructureIdentity(data.identity)) {
    fail("identity", "expected a structure created by this module");
  }
  const { atoms } = data.topology;
  if (atoms.radius) return atoms.radius;
  let radii = radiiCache.get(data.identity);
  if (!radii) {
    radii = Float32Array.from(atoms.element, elementRadius);
    radiiCache.set(data.identity, radii);
  }
  return radii;
}

const COVALENT_RADIUS: Readonly<Record<number, number>> = {
  1: .31,
  6: .76,
  7: .71,
  8: .66,
  15: 1.07,
  16: 1.05,
};

const compatibleBondRows = (
  data: StructureData,
  a: number,
  b: number,
  interChain: boolean,
): boolean => {
  const { atoms, residues, chains } = data.topology;
  const ra = atoms.residue[a], rb = atoms.residue[b];
  if (chains.model[residues.chain[ra]] !== chains.model[residues.chain[rb]]) {
    return false;
  }
  if (!interChain && residues.chain[ra] !== residues.chain[rb]) return false;
  return ra !== rb || !atoms.altloc[a] || !atoms.altloc[b] ||
    atoms.altloc[a] === atoms.altloc[b];
};

/** Shared topology for one structure revision. Explicit connectivity wins. */
export function bondTopology(
  data: StructureData,
  policy: BondPolicy = {},
): Bonds {
  const { padding = .45, interChain = true } = policy;
  if (!isStructureIdentity(data.identity)) {
    fail("identity", "expected a structure created by this module");
  }
  finite(padding, "policy.padding");
  if (padding < 0 || padding > 1) {
    fail("policy.padding", "expected value in [0, 1]");
  }
  if (typeof interChain !== "boolean") {
    fail("policy.interChain", "expected boolean");
  }
  if (data.topology.bonds.count) return data.topology.bonds;
  const key = `${data.revision.positions}:${padding}:${interChain}`;
  let byPolicy = inferredBondCache.get(data);
  if (!byPolicy) inferredBondCache.set(data, byPolicy = new Map());
  const cached = byPolicy.get(key);
  if (cached) return cached;
  const { atoms, residues, chains } = data.topology, P = data.positions;
  const candidates: number[] = [];
  let widest = 0;
  for (let i = 0; i < atoms.count; i++) {
    const radius = COVALENT_RADIUS[atoms.element[i]];
    if (!radius) continue;
    candidates.push(i);
    widest = Math.max(widest, radius);
  }
  // Cells span the largest possible cutoff, and bonds never cross models, so
  // superposed NMR models are partitioned apart instead of scanned.
  const model = (i: number): number =>
    chains.model[residues.chain[atoms.residue[i]]];
  const grid = candidates.length
    ? spatialGrid(P, candidates, 2 * widest + padding, model)
    : null;
  const a: number[] = [], b: number[] = [], near: number[] = [];
  for (const i of candidates) {
    const radius = COVALENT_RADIUS[atoms.element[i]];
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    near.length = 0;
    grid!.near(x, y, z, (j) => {
      if (j >= i || !compatibleBondRows(data, i, j, interChain)) return;
      const cutoff = radius + COVALENT_RADIUS[atoms.element[j]] + padding;
      const px = x - P[j * 3], py = y - P[j * 3 + 1], pz = z - P[j * 3 + 2];
      if (px * px + py * py + pz * pz <= cutoff * cutoff) near.push(j);
    }, model(i));
    // Canonical row order: by second endpoint, then first.
    near.sort((u, v) => u - v);
    for (const j of near) {
      a.push(j);
      b.push(i);
    }
  }
  const result: Bonds = Object.freeze({
    count: a.length,
    a: Uint32Array.from(a),
    b: Uint32Array.from(b),
    order: new Uint8Array(a.length).fill(1),
    source: Object.freeze(new Array<"inferred">(a.length).fill("inferred")),
    flags: new Uint8Array(a.length).fill(
      BOND_FLAGS.covalent | BOND_FLAGS.computed,
    ),
  });
  byPolicy.set(key, result);
  return result;
}

/** @internal Deep-module helper; selection consumers use bondTopology. */
export function selectBonds(
  data: StructureData,
  atomIndices: Uint32Array,
  options: { readonly mode?: "both" | "either"; readonly policy?: BondPolicy } =
    {},
): Uint32Array {
  const { mode = "both", policy } = options;
  if (!(atomIndices instanceof Uint32Array)) {
    fail("atomIndices", "expected Uint32Array");
  }
  if (!["both", "either"].includes(mode)) {
    fail("mode", "expected both or either");
  }
  const selected = new Set(atomIndices),
    bonds = bondTopology(data, policy),
    rows: number[] = [];
  for (let i = 0; i < bonds.count; i++) {
    const hitA = selected.has(bonds.a[i]), hitB = selected.has(bonds.b[i]);
    if (mode === "both" ? hitA && hitB : hitA || hitB) rows.push(i);
  }
  return Uint32Array.from(rows);
}
