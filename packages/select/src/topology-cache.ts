// Derived lookups for SelectionExpr evaluation: numeric views of string
// columns, per-atom chain rows and entity ordinals, once per topology object
// and revision. Held in a WeakMap, so they are released together with the
// structure (HARDENING: the selection cache stays bounded). The bond graph
// lives in bond-graph.ts.

import type { StructureData, Topology } from "@molgpu/table";

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
  /** Entity ordinal of each chain (first-seen order of chains.entityId); null without that column. */
  readonly chainEntity: Uint32Array | null;
}

const caches = new WeakMap<Topology, TopologyCache>();

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
  const { entityId } = data.topology.chains;
  let chainEntity: Uint32Array | null = null;
  if (entityId) {
    const ordinal = new Map<string, number>();
    chainEntity = Uint32Array.from(entityId, (id) => {
      let k = ordinal.get(id);
      if (k === undefined) ordinal.set(id, k = ordinal.size);
      return k;
    });
  }
  return Object.freeze({
    revision: data.revision.topology,
    allAtoms,
    authSeq,
    atomId,
    atomChain,
    chainEntity,
  });
}

export function topologyCache(data: StructureData): TopologyCache {
  let cache = caches.get(data.topology);
  if (!cache || cache.revision !== data.revision.topology) {
    caches.set(data.topology, cache = build(data));
  }
  return cache;
}
