// Derived lookups for SelectionExpr evaluation: numeric views of string
// columns and per-atom chain rows (once per topology object and revision), and
// bond adjacency (once per Bonds object, which bondTopology() already caches
// per positions revision when bonds are inferred). Both are held in WeakMaps,
// so they are released together with the structure (HARDENING: the selection
// cache stays bounded).

import type { Bonds, StructureData, Topology } from "@molgpu/table";

export interface TopologyCache {
  readonly revision: number;
  /** Every atom row, 0..n-1: the default input of a query. */
  readonly allAtoms: Uint32Array;
  /** residues.authSeq parsed to integers; unparsable values read 0, as in Mol*. */
  readonly authSeq: Int32Array;
  /** atoms.id parsed to integers (mmCIF _atom_site.id). */
  readonly atomId: Int32Array;
  /** Chain row of each atom. */
  readonly atomChain: Uint32Array;
}

/** Bond adjacency in CSR form: bonds of atom i are `bond[offsets[i]..offsets[i+1]]`. */
export interface Adjacency {
  readonly offsets: Uint32Array;
  readonly neighbour: Uint32Array;
  readonly bond: Uint32Array;
}

const caches = new WeakMap<Topology, TopologyCache>();
const adjacencies = new WeakMap<Bonds, Adjacency>();

const parseIntOrZero = (s: string): number => {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
};

function build(data: StructureData): TopologyCache {
  const { atoms, residues } = data.topology;
  const n = atoms.count;
  const allAtoms = new Uint32Array(n);
  const atomChain = new Uint32Array(n);
  const atomId = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    allAtoms[i] = i;
    atomChain[i] = residues.chain[atoms.residue[i]];
    atomId[i] = parseIntOrZero(atoms.id[i]);
  }
  const authSeq = Int32Array.from(residues.authSeq, parseIntOrZero);
  return Object.freeze({
    revision: data.revision.topology,
    allAtoms,
    authSeq,
    atomId,
    atomChain,
  });
}

export function topologyCache(data: StructureData): TopologyCache {
  let cache = caches.get(data.topology);
  if (!cache || cache.revision !== data.revision.topology) {
    caches.set(data.topology, cache = build(data));
  }
  return cache;
}

export function bondAdjacency(bonds: Bonds, atomCount: number): Adjacency {
  const cached = adjacencies.get(bonds);
  if (cached) return cached;
  const n = atomCount;
  const offsets = new Uint32Array(n + 1);
  for (let r = 0; r < bonds.count; r++) {
    offsets[bonds.a[r] + 1]++;
    offsets[bonds.b[r] + 1]++;
  }
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, n);
  const neighbour = new Uint32Array(offsets[n]);
  const bond = new Uint32Array(offsets[n]);
  for (let r = 0; r < bonds.count; r++) {
    const a = bonds.a[r], b = bonds.b[r];
    neighbour[fill[a]] = b;
    bond[fill[a]++] = r;
    neighbour[fill[b]] = a;
    bond[fill[b]++] = r;
  }

  const adjacency = Object.freeze({ offsets, neighbour, bond });
  adjacencies.set(bonds, adjacency);
  return adjacency;
}
