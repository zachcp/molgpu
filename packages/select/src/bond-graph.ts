// The typed bond graph selections traverse (include-connected, is-connected-to,
// bond-test). Separate from @molgpu/table's bondTopology(), which renderers draw.
//
// With explicit bonds, the graph is those bonds plus topology.links. Without
// them, it ports Mol*'s bond computation (mol-model/structure/structure/unit/
// bonds/intra-compute.js and inter-compute.js) so bond-dependent selections
// match Mol*:
// - struct_conn links are bonds in their own right, and a residue pair joined
//   by any struct_conn record gets no distance bonds;
// - inside a residue whose component has chem_comp_bond templates (and that is
//   not microheterogeneous), only template bonds count;
// - otherwise atoms bond when closer than Mol*'s element pair threshold,
//   skipping H-H pairs, incompatible altlocs and, between chains, two
//   partially occupied atoms of the same author residue number;
// - a bond to a metal is metal coordination, not covalent.
// Chains stand in for Mol*'s units.

import {
  BOND_FLAGS,
  type Bonds,
  bondTopology,
  spatialGrid,
  type StructureData,
} from "@molgpu/table";
import {
  DEFAULT_BOND_THRESHOLD,
  ELEMENT_BOND_THRESHOLD,
  METAL_ELEMENTS,
  PAIR_BOND_THRESHOLD,
} from "./bond-thresholds.ts";

/**
 * One edge per atom pair, flags OR-ed. Edge e joins a[e] and b[e]; the edges
 * of atom i are `edge[offsets[i]..offsets[i+1]]`, towards `neighbour[...]`.
 */
export interface BondGraph {
  readonly count: number;
  readonly a: Uint32Array;
  readonly b: Uint32Array;
  readonly order: Uint8Array;
  /** Bond type bits (BOND_FLAGS); 0 is unknown. */
  readonly flags: Uint8Array;
  readonly offsets: Uint32Array;
  readonly neighbour: Uint32Array;
  readonly edge: Uint32Array;
}

/** Mol*'s neighbour search radius for bond computation (DefaultBondMaxRadius). */
const MAX_RADIUS = 4;

const pairKey = (i: number, j: number) => i < j ? i * 1024 + j : j * 1024 + i;
const PAIR_THRESHOLD = new Map(
  PAIR_BOND_THRESHOLD.map(([i, j, r]) => [pairKey(i, j), r]),
);

/** Mol*'s element index: hydrogen 0, unknown -1, else the atomic number. */
const elementIndex = (z: number) => z === 1 ? 0 : z === 0 || z > 109 ? -1 : z;
const threshold = (e: number) =>
  e < 0 ? DEFAULT_BOND_THRESHOLD : ELEMENT_BOND_THRESHOLD[e];
/** Mol*'s getPairingThreshold. */
const pairing = (ea: number, eb: number): number => {
  const pair = ea >= 0 && eb >= 0 ? PAIR_THRESHOLD.get(pairKey(ea, eb)) : 0;
  if (pair && pair > 0) return pair;
  return eb < 0 ? threshold(ea) : (threshold(ea) + threshold(eb)) / 1.95;
};

class EdgeSet {
  private readonly index = new Map<number, number>();
  readonly a: number[] = [];
  readonly b: number[] = [];
  readonly order: number[] = [];
  readonly flags: number[] = [];
  constructor(private readonly n: number) {}
  add(x: number, y: number, order: number, flags: number): void {
    const key = Math.min(x, y) * this.n + Math.max(x, y);
    const e = this.index.get(key);
    if (e === undefined) {
      this.index.set(key, this.a.length);
      this.a.push(x);
      this.b.push(y);
      this.order.push(order);
      this.flags.push(flags);
    } else {
      this.order[e] = Math.max(this.order[e], order);
      this.flags[e] |= flags;
    }
  }
}

function freeze(edges: EdgeSet, n: number): BondGraph {
  const { a, b } = edges;
  const offsets = new Uint32Array(n + 1);
  for (let e = 0; e < a.length; e++) {
    offsets[a[e] + 1]++;
    offsets[b[e] + 1]++;
  }
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, n);
  const neighbour = new Uint32Array(offsets[n]);
  const edge = new Uint32Array(offsets[n]);
  for (let e = 0; e < a.length; e++) {
    neighbour[fill[a[e]]] = b[e];
    edge[fill[a[e]]++] = e;
    neighbour[fill[b[e]]] = a[e];
    edge[fill[b[e]]++] = e;
  }
  return Object.freeze({
    count: a.length,
    a: Uint32Array.from(a),
    b: Uint32Array.from(b),
    order: Uint8Array.from(edges.order),
    flags: Uint8Array.from(edges.flags),
    offsets,
    neighbour,
    edge,
  });
}

/** Explicit bonds as given (no flags reads unknown), plus links. */
function explicitGraph(data: StructureData, bonds: Bonds): BondGraph {
  const n = data.topology.atoms.count, links = data.topology.links;
  const edges = new EdgeSet(n);
  for (let r = 0; r < bonds.count; r++) {
    edges.add(bonds.a[r], bonds.b[r], bonds.order[r], bonds.flags?.[r] ?? 0);
  }
  for (let r = 0; links && r < links.count; r++) {
    edges.add(links.a[r], links.b[r], links.order[r], links.flags[r]);
  }
  return freeze(edges, n);
}

/** Mol*'s computed bonds over the whole structure. */
function computedGraph(data: StructureData): BondGraph {
  const { atoms, residues } = data.topology;
  const links = data.topology.links;
  const n = atoms.count, P = data.positions;
  const residue = atoms.residue;
  const chainOf = (i: number) => residues.chain[residue[i]];
  const element = Int16Array.from(atoms.element, elementIndex);
  const compatible = (i: number, j: number) =>
    !atoms.altloc[i] || !atoms.altloc[j] || atoms.altloc[i] === atoms.altloc[j];
  const d2 = (i: number, j: number) => {
    const dx = P[i * 3] - P[j * 3],
      dy = P[i * 3 + 1] - P[j * 3 + 1],
      dz = P[i * 3 + 2] - P[j * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const metallic = (i: number, j: number) =>
    (METAL_ELEMENTS.has(element[i]) || METAL_ELEMENTS.has(element[j])) &&
    element[i] !== 0 && element[j] !== 0;

  // Microheterogeneous residues are computed by distance, as in Mol*.
  const microhet = new Uint8Array(residues.count);
  if (atoms.comp) {
    for (let i = 0; i < n; i++) {
      if (atoms.comp[i] !== residues.comp[residue[i]]) microhet[residue[i]] = 1;
    }
  }
  const templated = new Uint8Array(residues.count);
  const connResidues = new Set<number>();
  const connPartners = new Map<number, number[]>();
  const edges = new EdgeSet(n);
  const component: number[] = [];
  for (let r = 0; links && r < links.count; r++) {
    const x = links.a[r], y = links.b[r];
    if (links.source[r] === "component") {
      if (!microhet[residue[x]]) templated[residue[x]] = 1;
      component.push(r);
      continue;
    }
    connResidues.add(pairKeyOf(residue[x], residue[y], residues.count));
    (connPartners.get(x) ?? connPartners.set(x, []).get(x)!).push(y);
    (connPartners.get(y) ?? connPartners.set(y, []).get(y)!).push(x);
    // Mol* adds struct_conn bonds between chains only within its search radius.
    if (chainOf(x) === chainOf(y) || d2(x, y) <= MAX_RADIUS * MAX_RADIUS) {
      edges.add(x, y, links.order[r], links.flags[r]);
    }
  }
  const residuePairLinked = (i: number, j: number) =>
    connResidues.size > 0 &&
    connResidues.has(pairKeyOf(residue[i], residue[j], residues.count));

  // Template bonds for templated residues (metal atoms make them metallic).
  for (const r of component) {
    const x = links!.a[r], y = links!.b[r];
    if (!templated[residue[x]] || residue[x] !== residue[y]) continue;
    if (!compatible(x, y) || residuePairLinked(x, y)) continue;
    if (element[x] === 0 && element[y] === 0) continue;
    if (d2(x, y) > MAX_RADIUS * MAX_RADIUS) continue;
    let flags = links!.flags[r];
    if (metallic(x, y)) {
      flags = (flags & ~BOND_FLAGS.covalent) | BOND_FLAGS.metallic;
    }
    edges.add(x, y, links!.order[r], flags);
  }

  // Distance bonds.
  const partnerChain = (i: number, chain: number) =>
    connPartners.get(i)?.some((p) => chainOf(p) === chain) ?? false;
  const grid = spatialGrid(P, null, MAX_RADIUS);
  const authSeq = residues.authSeq;
  for (let i = 0; i < n; i++) {
    const ci = chainOf(i), ri = residue[i];
    grid.near(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], (j) => {
      if (j <= i || !compatible(i, j)) return;
      const dd = d2(i, j);
      if (dd > MAX_RADIUS * MAX_RADIUS || dd === 0) return;
      if (residuePairLinked(i, j)) return;
      if (element[i] === 0 && element[j] === 0) return; // H-H
      const cj = chainOf(j), rj = residue[j];
      if (ci === cj) {
        if (ri === rj && templated[ri]) return;
        if (connPartners.get(i)?.includes(j)) return;
      } else {
        if (partnerChain(i, cj) || partnerChain(j, ci)) return;
        if (
          atoms.occupancy[i] < 1 && atoms.occupancy[j] < 1 &&
          authSeq[ri] === authSeq[rj]
        ) return;
      }
      if (Math.sqrt(dd) <= pairing(element[i], element[j])) {
        edges.add(
          i,
          j,
          1,
          (metallic(i, j) ? BOND_FLAGS.metallic : BOND_FLAGS.covalent) |
            BOND_FLAGS.computed,
        );
      }
    });
  }
  return freeze(edges, n);
}

const pairKeyOf = (x: number, y: number, count: number) =>
  Math.min(x, y) * count + Math.max(x, y);

const NO_LINKS = {};
const explicit = new WeakMap<Bonds, WeakMap<object, BondGraph>>();
const computed = new WeakMap<
  StructureData["topology"],
  { key: string; graph: BondGraph }
>();

/**
 * The bond graph for a structure: explicit bonds plus links when the structure
 * declares bonds, otherwise Mol*'s computed bonds. Cached per bonds and links
 * objects, or per topology (one topology and positions revision) when computed.
 */
export function bondGraph(data: StructureData): BondGraph {
  const { topology } = data;
  if (topology.bonds.count) {
    const bonds = bondTopology(data);
    let byLinks = explicit.get(bonds);
    if (!byLinks) explicit.set(bonds, byLinks = new WeakMap());
    let graph = byLinks.get(topology.links ?? NO_LINKS);
    if (!graph) {
      byLinks.set(
        topology.links ?? NO_LINKS,
        graph = explicitGraph(data, bonds),
      );
    }
    return graph;
  }
  const key = `${data.revision.topology}:${data.revision.positions}`;
  const cached = computed.get(topology);
  if (cached?.key === key) return cached.graph;
  const graph = computedGraph(data);
  computed.set(topology, { key, graph });
  return graph;
}
