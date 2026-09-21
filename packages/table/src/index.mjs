// Pure molecular values. Arrays are packed CPU columns and immutable by contract.
// No renderer, parser, or global platform API is required by this module.
export { traceTable } from './trace.mjs';
export { secondaryStructureTrace } from './secondary-structure.mjs';
const revisions = new WeakMap();
const inferredBondCache = new WeakMap();
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };
const finite = (value, path) => { if (!Number.isFinite(value)) fail(path, 'expected finite number'); };
const count = (n, path) => { if (!Number.isSafeInteger(n) || n < 0) fail(path, 'expected nonnegative safe integer'); };
const column = (value, length, Type, path) => {
  if (!(value instanceof Type) || value.length !== length) fail(path, `expected ${Type.name}[${length}]`);
};
const strings = (value, n, path) => {
  if (!Array.isArray(value) || value.length !== n || value.some(x => typeof x !== 'string')) fail(path, `expected string[${n}]`);
};
const refs = (array, n, path) => {
  for (let i = 0; i < array.length; i++) if (array[i] >= n) fail(`${path}[${i}]`, 'foreign key out of range');
};
const copyDomain = domain => Object.freeze(Object.fromEntries(Object.entries(domain).map(([key, value]) =>
  [key, ArrayBuffer.isView(value) ? value.slice() : Array.isArray(value) ? Object.freeze([...value]) : value])));

/** Validate logical rows, packed strides, identity columns and foreign keys. */
export function validateStructure(data) {
  const { topology: t, positions } = data;
  if (!t) fail('topology', 'required');
  for (const name of ['atoms', 'residues', 'chains', 'bonds', 'instances']) {
    if (!t[name]) fail(name, 'required domain');
    count(t[name].count, `${name}.count`);
  }
  const { atoms: a, residues: r, chains: c, bonds: b, instances: ins } = t;
  column(positions, a.count * 3, Float32Array, 'positions');
  positions.forEach((v, i) => finite(v, `positions[${i}]`));
  for (const k of ['id', 'name', 'altloc']) strings(a[k], a.count, `atoms.${k}`);
  column(a.residue, a.count, Uint32Array, 'atoms.residue'); refs(a.residue, r.count, 'atoms.residue');
  column(a.element, a.count, Uint8Array, 'atoms.element');
  for (const k of ['occupancy', 'bfactor']) {
    column(a[k], a.count, Float32Array, `atoms.${k}`);
    a[k].forEach((v, i) => finite(v, `atoms.${k}[${i}]`));
  }
  if (a.radius !== undefined) {
    column(a.radius, a.count, Float32Array, 'atoms.radius');
    a.radius.forEach((v, i) => { if (!Number.isFinite(v) || v <= 0) fail(`atoms.radius[${i}]`, 'expected positive Angstrom radius'); });
  }
  a.element.forEach((v, i) => { if (v > 118) fail(`atoms.element[${i}]`, 'expected atomic number 0 (unknown) to 118'); });
  a.occupancy.forEach((v, i) => { if (v < 0 || v > 1) fail(`atoms.occupancy[${i}]`, 'expected occupancy in [0,1]'); });
  const sites = new Set();
  for (let i = 0; i < a.count; i++) {
    const key = JSON.stringify([a.residue[i], a.name[i], a.altloc[i]]);
    if (sites.has(key)) fail(`atoms[${i}]`, 'duplicate residue/name/altloc site');
    sites.add(key);
  }
  column(r.chain, r.count, Uint32Array, 'residues.chain'); refs(r.chain, c.count, 'residues.chain');
  column(r.labelSeq, r.count, Int32Array, 'residues.labelSeq');
  for (const k of ['authSeq', 'insertionCode', 'comp', 'polymer']) strings(r[k], r.count, `residues.${k}`);
  r.polymer.forEach((v, i) => { if (!['protein', 'rna', 'dna', 'other'].includes(v)) fail(`residues.polymer[${i}]`, 'unknown polymer kind'); });
  if (r.secondaryStructure !== undefined) {
    strings(r.secondaryStructure, r.count, 'residues.secondaryStructure');
    r.secondaryStructure.forEach((v, i) => { if (!['helix', 'sheet', 'coil'].includes(v)) fail(`residues.secondaryStructure[${i}]`, 'unknown secondary structure kind'); });
  }
  column(c.model, c.count, Int32Array, 'chains.model');
  for (const k of ['labelId', 'authId']) strings(c[k], c.count, `chains.${k}`);
  const chainKeys = new Set();
  for (let i = 0; i < c.count; i++) {
    const key = JSON.stringify([c.model[i], c.labelId[i]]);
    if (chainKeys.has(key)) fail(`chains[${i}]`, 'duplicate model/label chain identity');
    chainKeys.add(key);
  }
  for (const k of ['a', 'b']) { column(b[k], b.count, Uint32Array, `bonds.${k}`); refs(b[k], a.count, `bonds.${k}`); }
  column(b.order, b.count, Uint8Array, 'bonds.order'); strings(b.source, b.count, 'bonds.source');
  const pairs = new Set();
  for (let i = 0; i < b.count; i++) {
    const x = b.a[i], y = b.b[i];
    if (x === y) fail(`bonds[${i}]`, 'self bond');
    if (c.model[r.chain[a.residue[x]]] !== c.model[r.chain[a.residue[y]]]) fail(`bonds[${i}]`, 'cross-model bond');
    if (a.residue[x] === a.residue[y] && a.altloc[x] && a.altloc[y] && a.altloc[x] !== a.altloc[y]) fail(`bonds[${i}]`, 'incompatible residue altlocs');
    if (b.order[i] > 4) fail(`bonds.order[${i}]`, 'expected 0 unknown, 1/2/3, or 4 aromatic');
    if (!['explicit', 'inferred'].includes(b.source[i])) fail(`bonds.source[${i}]`, 'expected explicit or inferred');
    const key = `${Math.min(x, y)}:${Math.max(x, y)}`;
    if (pairs.has(key)) fail(`bonds[${i}]`, 'duplicate bond');
    pairs.add(key);
  }
  column(ins.chain, ins.count, Uint32Array, 'instances.chain'); refs(ins.chain, c.count, 'instances.chain');
  strings(ins.operatorId, ins.count, 'instances.operatorId');
  column(ins.transform, ins.count * 16, Float64Array, 'instances.transform');
  ins.transform.forEach((v, i) => finite(v, `instances.transform[${i}]`));
  for (let i = 0; i < ins.count; i++) {
    const m = ins.transform.subarray(i * 16, i * 16 + 16);
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) fail(`instances.transform[${i}]`, 'expected column-major affine transform');
  }
  return data;
}

/** Takes copies of all input columns; callers retain ownership of inputs. */
export function createStructure(input) {
  validateStructure(input);
  const identity = Object.freeze({});
  revisions.set(identity, 0);
  const topology = Object.freeze(Object.fromEntries(Object.entries(input.topology).map(([k, v]) => [k, copyDomain(v)])));
  return Object.freeze({ identity, topology, positions: input.positions.slice(),
    revision: Object.freeze({ topology: 0, positions: 0, attributes: 0 }) });
}

/** Coordinate-only updates preserve dataset/topology identity. Branch revisions never collide. */
export function withPositions(data, positions) {
  if (!revisions.has(data.identity)) fail('identity', 'expected a structure created by this module');
  column(positions, data.topology.atoms.count * 3, Float32Array, 'positions');
  positions.forEach((v, i) => finite(v, `positions[${i}]`));
  const revision = revisions.get(data.identity) + 1;
  if (!Number.isSafeInteger(revision)) fail('revision', 'revision exhausted');
  revisions.set(data.identity, revision);
  return Object.freeze({ ...data, positions: positions.slice(), revision: Object.freeze({ ...data.revision, positions: revision }) });
}

/** Explicit view policy; retains all source rows in the underlying dataset.
 * Defaults: first encountered model, residue conformer with largest summed
 * occupancy (lexical tie-break), plus atoms with blank altloc. */
export function activeAtoms(data, { model = 'first', altloc = 'primary' } = {}) {
  const { atoms: a, residues: r, chains: c } = data.topology;
  if (model !== 'first' && model !== 'all' && !Number.isInteger(model)) fail('policy.model', 'expected first, all, or model id');
  if (!['all', 'primary'].includes(altloc)) fail('policy.altloc', 'expected all or primary');
  const chosen = model === 'first' ? c.model[0] : model;
  if (typeof chosen === 'number' && !c.model.includes(chosen)) fail('policy.model', 'model not present');
  const scores = new Map(), conformers = new Map();
  if (altloc === 'primary') {
    for (let i = 0; i < a.count; i++) {
      if (!a.altloc[i]) continue;
      const residue = a.residue[i];
      if (!scores.has(residue)) scores.set(residue, new Map());
      const byLabel = scores.get(residue);
      byLabel.set(a.altloc[i], (byLabel.get(a.altloc[i]) ?? 0) + a.occupancy[i]);
    }
    for (const [residue, byLabel] of scores) {
      conformers.set(residue, [...byLabel].sort(([ka, va], [kb, vb]) => vb - va || (ka < kb ? -1 : ka > kb ? 1 : 0))[0][0]);
    }
  }
  const indices = [];
  for (let i = 0; i < a.count; i++) {
    if (chosen !== 'all' && c.model[r.chain[a.residue[i]]] !== chosen) continue;
    if (altloc === 'primary' && a.altloc[i] && a.altloc[i] !== conformers.get(a.residue[i])) continue;
    indices.push(i);
  }
  return Uint32Array.from(indices);
}

/** Source identifier for joins; includes both author and label namespaces. */
export function residueKey(data, row) {
  const { residues: r, chains: c } = data.topology;
  if (!Number.isInteger(row) || row < 0 || row >= r.count) fail('residue', 'row out of range');
  const chain = r.chain[row];
  return JSON.stringify([c.model[chain], c.labelId[chain], c.authId[chain], r.labelSeq[row], r.authSeq[row], r.insertionCode[row], r.comp[row]]);
}

/** Untransformed coordinate bounds, deliberately separate from camera framing. */
export function coordinateBounds(data, indices) {
  const n = indices?.length ?? data.topology.atoms.count;
  if (!n) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < n; j++) {
    const i = indices ? indices[j] : j;
    if (!Number.isInteger(i) || i < 0 || i >= data.topology.atoms.count) fail('indices', 'atom out of range');
    for (let k = 0; k < 3; k++) {
      const v = data.positions[i * 3 + k];
      min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v);
    }
  }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2) };
}

const COVALENT_RADIUS = { 1: .31, 6: .76, 7: .71, 8: .66, 15: 1.07, 16: 1.05 };

const compatibleBondRows = (data, a, b, interChain) => {
  const { atoms, residues, chains } = data.topology;
  const ra = atoms.residue[a], rb = atoms.residue[b];
  if (chains.model[residues.chain[ra]] !== chains.model[residues.chain[rb]]) return false;
  if (!interChain && residues.chain[ra] !== residues.chain[rb]) return false;
  return ra !== rb || !atoms.altloc[a] || !atoms.altloc[b] || atoms.altloc[a] === atoms.altloc[b];
};

/** Shared topology for one structure revision. Explicit connectivity wins. */
export function bondTopology(data, { padding = .45, interChain = true } = {}) {
  if (!revisions.has(data.identity)) fail('identity', 'expected a structure created by this module');
  finite(padding, 'policy.padding');
  if (padding < 0 || padding > 1) fail('policy.padding', 'expected value in [0, 1]');
  if (typeof interChain !== 'boolean') fail('policy.interChain', 'expected boolean');
  if (data.topology.bonds.count) return data.topology.bonds;
  const key = `${data.revision.positions}:${padding}:${interChain}`;
  let byPolicy = inferredBondCache.get(data);
  if (!byPolicy) inferredBondCache.set(data, byPolicy = new Map());
  const cached = byPolicy.get(key);
  if (cached) return cached;
  const { atoms } = data.topology, cellSize = 3, cells = new Map(), a = [], b = [];
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < atoms.count; i++) {
    const radius = COVALENT_RADIUS[atoms.element[i]];
    if (!radius) continue;
    const x = data.positions[i * 3], y = data.positions[i * 3 + 1], z = data.positions[i * 3 + 2];
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize), cz = Math.floor(z / cellSize);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cells.get(cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
        if (!compatibleBondRows(data, i, j, interChain)) continue;
        const cutoff = radius + COVALENT_RADIUS[atoms.element[j]] + padding;
        const px = x - data.positions[j * 3], py = y - data.positions[j * 3 + 1], pz = z - data.positions[j * 3 + 2];
        if (px * px + py * py + pz * pz <= cutoff * cutoff) { a.push(j); b.push(i); }
      }
    }
    const cell = cellKey(cx, cy, cz), rows = cells.get(cell) ?? []; rows.push(i); cells.set(cell, rows);
  }
  const result = Object.freeze({ count: a.length, a: Uint32Array.from(a), b: Uint32Array.from(b),
    order: new Uint8Array(a.length).fill(1), source: Object.freeze(new Array(a.length).fill('inferred')) });
  byPolicy.set(key, result);
  return result;
}

/** Resolve bond rows whose endpoints are both selected, or either selected. */
export function selectBonds(data, atomIndices, { mode = 'both', policy } = {}) {
  if (!(atomIndices instanceof Uint32Array)) fail('atomIndices', 'expected Uint32Array');
  if (!['both', 'either'].includes(mode)) fail('mode', 'expected both or either');
  const selected = new Set(atomIndices), bonds = bondTopology(data, policy), rows = [];
  for (let i = 0; i < bonds.count; i++) {
    const hitA = selected.has(bonds.a[i]), hitB = selected.has(bonds.b[i]);
    if (mode === 'both' ? hitA && hitB : hitA || hitB) rows.push(i);
  }
  return Uint32Array.from(rows);
}
