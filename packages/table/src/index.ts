// Pure molecular values. Arrays are packed CPU columns and immutable by contract.
// No renderer, parser, or global platform API is required by this module.
import type {
  AttributeColumn,
  AttributeColumnInput,
  AttributeDomain,
  AttributeValues,
  BondPolicy,
  Bonds,
  StructureData,
  StructureInput,
  ViewPolicy,
} from "./types.ts";

export type * from "./types.ts";
export { traceTable } from "./trace.ts";
export { secondaryStructureTrace } from "./secondary-structure.ts";
export { SS_CODES, ssKind } from "./ss-codes.ts";
export { dssp, type DsspOptions, withSecondaryStructure } from "./dssp.ts";
export { type SpatialGrid, spatialGrid } from "./spatial-grid.ts";
export {
  createVolume,
  MAX_VOLUME_SAMPLES,
  sampleVolume,
  validateVolume,
  volumeComponent,
  volumeIndexToWorld,
  volumeInverseTransform,
  volumeLevel,
  volumeWorldToIndex,
} from "./volume.ts";
export {
  createTrajectory,
  frameAtTime,
  trajectoryFromModels,
  validateTrajectory,
  validateTrajectoryFrame,
} from "./trajectory.ts";

import { spatialGrid } from "./spatial-grid.ts";
import { legacySsCodes } from "./ss-codes.ts";

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

type TypedArrayConstructor =
  | Float32ArrayConstructor
  | Uint32ArrayConstructor
  | Int32ArrayConstructor
  | Uint8ArrayConstructor
  | Int8ArrayConstructor
  | Float64ArrayConstructor;
type Domain = Record<string, unknown>;
type Identity = StructureData["identity"];

const revisions = new WeakMap<Identity, number>();
const radiiCache = new WeakMap<Identity, Float32Array>();
const inferredBondCache = new WeakMap<StructureData, Map<string, Bonds>>();
const builtInAttributeCache = new WeakMap<
  Identity,
  Map<string, AttributeColumn>
>();
const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};
const finite = (value: number, path: string): void => {
  if (!Number.isFinite(value)) fail(path, "expected finite number");
};
const count = (n: number, path: string): void => {
  if (!Number.isSafeInteger(n) || n < 0) {
    fail(path, "expected nonnegative safe integer");
  }
};
const column = (
  value: unknown,
  length: number,
  Type: TypedArrayConstructor,
  path: string,
): void => {
  if (!(value instanceof Type) || value.length !== length) {
    fail(path, `expected ${Type.name}[${length}]`);
  }
};
const strings = (value: unknown, n: number, path: string): void => {
  if (
    !Array.isArray(value) || value.length !== n ||
    value.some((x) => typeof x !== "string")
  ) fail(path, `expected string[${n}]`);
};
const refs = (array: ArrayLike<number>, n: number, path: string): void => {
  for (let i = 0; i < array.length; i++) {
    if (array[i] >= n) fail(`${path}[${i}]`, "foreign key out of range");
  }
};
const copyDomain = (domain: object): Readonly<Domain> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(domain).map((
        [key, value],
      ) => [
        key,
        ArrayBuffer.isView(value)
          ? (value as Float32Array).slice()
          : Array.isArray(value)
          ? Object.freeze([...value])
          : value,
      ]),
    ),
  );
const isIdentity = (value: unknown): value is Identity =>
  typeof value === "object" && value !== null &&
  revisions.has(value as Identity);

/** Validate logical rows, packed strides, identity columns and foreign keys. */
export function validateStructure<T extends StructureInput>(data: T): T {
  const { topology: t, positions } = data;
  if (!t) fail("topology", "required");
  for (
    const name of ["atoms", "residues", "chains", "bonds", "instances"] as const
  ) {
    if (!t[name]) fail(name, "required domain");
    count(t[name].count, `${name}.count`);
  }
  const { atoms: a, residues: r, chains: c, bonds: b, instances: ins } = t;
  column(positions, a.count * 3, Float32Array, "positions");
  positions.forEach((v, i) => finite(v, `positions[${i}]`));
  for (const k of ["id", "name", "altloc"] as const) {
    strings(a[k], a.count, `atoms.${k}`);
  }
  column(a.residue, a.count, Uint32Array, "atoms.residue");
  refs(a.residue, r.count, "atoms.residue");
  column(a.element, a.count, Uint8Array, "atoms.element");
  for (const k of ["occupancy", "bfactor"] as const) {
    column(a[k], a.count, Float32Array, `atoms.${k}`);
    a[k].forEach((v, i) => finite(v, `atoms.${k}[${i}]`));
  }
  if (a.radius !== undefined) {
    column(a.radius, a.count, Float32Array, "atoms.radius");
    a.radius.forEach((v, i) => {
      if (!Number.isFinite(v) || v <= 0) {
        fail(`atoms.radius[${i}]`, "expected positive Angstrom radius");
      }
    });
  }
  if (a.comp !== undefined) strings(a.comp, a.count, "atoms.comp");
  if (a.formalCharge !== undefined) {
    column(a.formalCharge, a.count, Int8Array, "atoms.formalCharge");
  }
  a.element.forEach((v, i) => {
    if (v > 118) {
      fail(`atoms.element[${i}]`, "expected atomic number 0 (unknown) to 118");
    }
  });
  a.occupancy.forEach((v, i) => {
    if (v < 0 || v > 1) {
      fail(`atoms.occupancy[${i}]`, "expected occupancy in [0,1]");
    }
  });
  // Length-prefixing the name keeps the key unambiguous for any strings,
  // without the cost of JSON-encoding an array per atom.
  const sites = new Set<string>();
  for (let i = 0; i < a.count; i++) {
    const key = `${a.residue[i]}:${a.name[i].length}:${a.name[i]}${
      a.altloc[i]
    }`;
    if (sites.has(key)) {
      fail(`atoms[${i}]`, "duplicate residue/name/altloc site");
    }
    sites.add(key);
  }
  column(r.chain, r.count, Uint32Array, "residues.chain");
  refs(r.chain, c.count, "residues.chain");
  column(r.labelSeq, r.count, Int32Array, "residues.labelSeq");
  for (const k of ["authSeq", "insertionCode", "comp", "polymer"] as const) {
    strings(r[k], r.count, `residues.${k}`);
  }
  r.polymer.forEach((v, i) => {
    if (!["protein", "rna", "dna", "other"].includes(v)) {
      fail(`residues.polymer[${i}]`, "unknown polymer kind");
    }
  });
  if (r.secondaryStructure !== undefined) {
    strings(r.secondaryStructure, r.count, "residues.secondaryStructure");
    r.secondaryStructure.forEach((v, i) => {
      if (!["helix", "sheet", "coil"].includes(v)) {
        fail(
          `residues.secondaryStructure[${i}]`,
          "unknown secondary structure kind",
        );
      }
    });
  }
  if (r.het !== undefined) {
    column(r.het, r.count, Uint8Array, "residues.het");
    r.het.forEach((v, i) => {
      if (v > 1) fail(`residues.het[${i}]`, "expected 0 or 1");
    });
  }
  column(c.model, c.count, Int32Array, "chains.model");
  for (const k of ["labelId", "authId"] as const) {
    strings(c[k], c.count, `chains.${k}`);
  }
  if (c.entityId !== undefined) {
    strings(c.entityId, c.count, "chains.entityId");
  }
  if (c.entityType !== undefined) {
    if (c.entityId === undefined) {
      fail("chains.entityType", "requires chains.entityId");
    }
    strings(c.entityType, c.count, "chains.entityType");
  }
  if (c.entitySubtype !== undefined) {
    if (c.entityId === undefined) {
      fail("chains.entitySubtype", "requires chains.entityId");
    }
    strings(c.entitySubtype, c.count, "chains.entitySubtype");
  }
  const chainKeys = new Set<string>();
  for (let i = 0; i < c.count; i++) {
    const key = JSON.stringify([c.model[i], c.labelId[i]]);
    if (chainKeys.has(key)) {
      fail(`chains[${i}]`, "duplicate model/label chain identity");
    }
    chainKeys.add(key);
  }
  for (const k of ["a", "b"] as const) {
    column(b[k], b.count, Uint32Array, `bonds.${k}`);
    refs(b[k], a.count, `bonds.${k}`);
  }
  column(b.order, b.count, Uint8Array, "bonds.order");
  strings(b.source, b.count, "bonds.source");
  const pairs = new Set<number>();
  for (let i = 0; i < b.count; i++) {
    const x = b.a[i], y = b.b[i];
    if (x === y) fail(`bonds[${i}]`, "self bond");
    if (c.model[r.chain[a.residue[x]]] !== c.model[r.chain[a.residue[y]]]) {
      fail(`bonds[${i}]`, "cross-model bond");
    }
    if (
      a.residue[x] === a.residue[y] && a.altloc[x] && a.altloc[y] &&
      a.altloc[x] !== a.altloc[y]
    ) fail(`bonds[${i}]`, "incompatible residue altlocs");
    if (b.order[i] > 4) {
      fail(`bonds.order[${i}]`, "expected 0 unknown, 1/2/3, or 4 aromatic");
    }
    if (!["explicit", "inferred"].includes(b.source[i])) {
      fail(`bonds.source[${i}]`, "expected explicit or inferred");
    }
    // Unordered pair as one exact integer: a.count² stays far below 2^53.
    const key = Math.min(x, y) * a.count + Math.max(x, y);
    if (pairs.has(key)) fail(`bonds[${i}]`, "duplicate bond");
    pairs.add(key);
  }
  if (b.flags !== undefined) {
    column(b.flags, b.count, Uint8Array, "bonds.flags");
  }
  const l = t.links;
  if (l !== undefined) {
    count(l.count, "links.count");
    for (const k of ["a", "b"] as const) {
      column(l[k], l.count, Uint32Array, `links.${k}`);
      refs(l[k], a.count, `links.${k}`);
    }
    column(l.order, l.count, Uint8Array, "links.order");
    column(l.flags, l.count, Uint8Array, "links.flags");
    strings(l.source, l.count, "links.source");
    for (let i = 0; i < l.count; i++) {
      if (l.a[i] === l.b[i]) fail(`links[${i}]`, "self link");
      if (l.order[i] > 4) fail(`links.order[${i}]`, "expected 0 to 4");
      if (l.source[i] !== "component" && l.source[i] !== "struct_conn") {
        fail(`links.source[${i}]`, "expected component or struct_conn");
      }
    }
  }
  column(ins.chain, ins.count, Uint32Array, "instances.chain");
  refs(ins.chain, c.count, "instances.chain");
  strings(ins.operatorId, ins.count, "instances.operatorId");
  column(ins.transform, ins.count * 16, Float64Array, "instances.transform");
  ins.transform.forEach((v, i) => finite(v, `instances.transform[${i}]`));
  for (let i = 0; i < ins.count; i++) {
    const m = ins.transform.subarray(i * 16, i * 16 + 16);
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) {
      fail(
        `instances.transform[${i}]`,
        "expected column-major affine transform",
      );
    }
  }
  return data;
}

/** Takes copies of all input columns; callers retain ownership of inputs. */
export function createStructure(input: StructureInput): StructureData {
  validateStructure(input);
  const identity = Object.freeze({}) as Identity;
  revisions.set(identity, 0);
  const topology = Object.freeze(
    Object.fromEntries(
      Object.entries(input.topology).map(([k, v]) => [k, copyDomain(v)]),
    ),
  );
  return Object.freeze({
    identity,
    topology: topology as unknown as StructureData["topology"],
    positions: input.positions.slice(),
    revision: Object.freeze({ topology: 0, positions: 0, attributes: 0 }),
  });
}

/** Coordinate-only updates preserve dataset/topology identity. Branch revisions never collide. */
export function withPositions(
  data: StructureData,
  positions: Float32Array,
): StructureData {
  if (!isIdentity(data.identity)) {
    fail("identity", "expected a structure created by this module");
  }
  column(positions, data.topology.atoms.count * 3, Float32Array, "positions");
  positions.forEach((v, i) => finite(v, `positions[${i}]`));
  const revision = revisions.get(data.identity)! + 1;
  if (!Number.isSafeInteger(revision)) fail("revision", "revision exhausted");
  revisions.set(data.identity, revision);
  return Object.freeze({
    ...data,
    positions: positions.slice(),
    revision: Object.freeze({ ...data.revision, positions: revision }),
  });
}

const ATTRIBUTE_NAMES = /^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/;
const PROVENANCE =
  /^(legacy|default|user|(?:imported|template|computed|gpu):[A-Za-z0-9][A-Za-z0-9._-]*)$/;
const WELL_KNOWN = {
  formalCharge: { domain: "atom", Type: Int8Array, kind: "code" },
  partialCharge: { domain: "atom", Type: Float32Array, kind: "scalar" },
  ssCode: { domain: "residue", Type: Uint8Array, kind: "code" },
} as const;
const BUILT_INS = {
  element: {
    domain: "atom",
    kind: "code",
    read: (d: StructureData) => d.topology.atoms.element,
  },
  occupancy: {
    domain: "atom",
    kind: "scalar",
    read: (d: StructureData) => d.topology.atoms.occupancy,
  },
  bfactor: {
    domain: "atom",
    kind: "scalar",
    read: (d: StructureData) => d.topology.atoms.bfactor,
  },
  radius: {
    domain: "atom",
    kind: "scalar",
    read: (d: StructureData) => d.topology.atoms.radius,
  },
  residue: {
    domain: "atom",
    kind: "code",
    read: (d: StructureData) => d.topology.atoms.residue,
  },
  atomChain: {
    domain: "atom",
    kind: "code",
    read: (d: StructureData) =>
      Uint32Array.from(
        d.topology.atoms.residue,
        (r) => d.topology.residues.chain[r],
      ),
  },
  labelSeq: {
    domain: "residue",
    kind: "code",
    read: (d: StructureData) => d.topology.residues.labelSeq,
  },
  chain: {
    domain: "residue",
    kind: "code",
    read: (d: StructureData) => d.topology.residues.chain,
  },
  formalCharge: {
    domain: "atom",
    kind: "code",
    read: (d: StructureData) => d.topology.atoms.formalCharge,
  },
  // Hand-built structures' 3-state column, as codes (helix H, sheet E).
  ssCode: {
    domain: "residue",
    kind: "code",
    read: (d: StructureData) => {
      const kinds = d.topology.residues.secondaryStructure;
      return kinds ? legacySsCodes(kinds) : undefined;
    },
  },
} as const;
const VALUE_TYPES = [
  Float32Array,
  Int8Array,
  Uint8Array,
  Int32Array,
  Uint32Array,
];

/** A registered derived column, or a stable view of a built-in topology column. */
export function attributeColumn(
  data: StructureData,
  name: string,
): AttributeColumn | undefined {
  const derived = data.attributes && Object.hasOwn(data.attributes, name)
    ? data.attributes[name]
    : undefined;
  if (derived) return derived;
  const spec = Object.hasOwn(BUILT_INS, name)
    ? BUILT_INS[name as keyof typeof BUILT_INS]
    : undefined;
  if (!spec) return undefined;
  let cache = builtInAttributeCache.get(data.identity);
  if (!cache) builtInAttributeCache.set(data.identity, cache = new Map());
  const cached = cache.get(name);
  if (cached) return cached;
  const values = spec.read(data);
  if (!values) return undefined;
  const result: AttributeColumn = Object.freeze({
    name,
    domain: spec.domain,
    kind: spec.kind,
    values,
    provenance: name === "atomChain" ? "default" : "legacy",
  });
  cache.set(name, result);
  return result;
}

/** Names currently resolvable on this dataset. */
export function attributeNames(data: StructureData): string[] {
  return [
    ...new Set([
      ...Object.keys(BUILT_INS).filter((name) => attributeColumn(data, name)),
      ...Object.keys(data.attributes ?? {}),
    ]),
  ];
}

/** Add or remove derived columns without changing topology or coordinates. */
export function withAttributes(
  data: StructureData,
  changes: Readonly<Record<string, AttributeColumnInput | null>>,
): StructureData {
  if (!isIdentity(data.identity)) {
    fail("identity", "expected a structure created by this module");
  }
  const next: Record<string, AttributeColumn> = { ...data.attributes };
  let changed = false;
  for (const [name, input] of Object.entries(changes)) {
    const known = Object.hasOwn(WELL_KNOWN, name)
      ? WELL_KNOWN[name as keyof typeof WELL_KNOWN]
      : undefined;
    if (!known && !ATTRIBUTE_NAMES.test(name)) {
      fail(`attributes.${name}`, "expected a well-known or namespaced name");
    }
    if (input === null) {
      if (name in next) {
        delete next[name];
        changed = true;
      }
      continue;
    }
    if (!input || !["atom", "residue"].includes(input.domain)) {
      fail(`attributes.${name}.domain`, "expected atom or residue");
    }
    if (!["scalar", "code"].includes(input.kind)) {
      fail(`attributes.${name}.kind`, "expected scalar or code");
    }
    if (known && (input.domain !== known.domain || input.kind !== known.kind)) {
      fail(`attributes.${name}`, `expected ${known.domain} ${known.kind}`);
    }
    if (!PROVENANCE.test(input.provenance)) {
      fail(`attributes.${name}.provenance`, "invalid provenance");
    }
    const values = input.values;
    const expected = input.domain === "atom"
      ? data.topology.atoms.count
      : data.topology.residues.count;
    if (
      !VALUE_TYPES.some((Type) => values instanceof Type) ||
      values.length !== expected || (known && !(values instanceof known.Type))
    ) {
      fail(
        `attributes.${name}.values`,
        `expected typed array[${expected}]${
          known ? ` of ${known.Type.name}` : ""
        }`,
      );
    }
    if (values instanceof Float32Array) {
      values.forEach((value, i) =>
        finite(value, `attributes.${name}.values[${i}]`)
      );
    }
    next[name] = Object.freeze({
      name,
      domain: input.domain as AttributeDomain,
      kind: input.kind,
      values: values.slice() as AttributeValues,
      provenance: input.provenance,
    });
    changed = true;
  }
  if (!changed) return data;
  const revision = revisions.get(data.identity)! + 1;
  if (!Number.isSafeInteger(revision)) fail("revision", "revision exhausted");
  revisions.set(data.identity, revision);
  return Object.freeze({
    ...data,
    attributes: Object.freeze(next),
    revision: Object.freeze({ ...data.revision, attributes: revision }),
  });
}

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
  if (!isIdentity(data.identity)) {
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
  if (!isIdentity(data.identity)) {
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

/** Resolve bond rows whose endpoints are both selected, or either selected. */
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
