// Pure molecular values. Arrays are packed CPU columns and immutable by contract.
// No renderer, parser, or global platform API is required by this module.

import type { StructureData, StructureInput } from "./structure-types.ts";

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
/** @internal Shared by implementation modules; not part of the package API. */
export const isStructureIdentity = (value: unknown): value is Identity =>
  typeof value === "object" && value !== null &&
  revisions.has(value as Identity);

/** @internal Advance a structure identity's private branch revision. */
export function nextStructureRevision(identity: Identity): number {
  const revision = revisions.get(identity)! + 1;
  if (!Number.isSafeInteger(revision)) fail("revision", "revision exhausted");
  revisions.set(identity, revision);
  return revision;
}

/** @internal createStructure validates these invariants automatically. */
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
  if (!isStructureIdentity(data.identity)) {
    fail("identity", "expected a structure created by this module");
  }
  column(positions, data.topology.atoms.count * 3, Float32Array, "positions");
  positions.forEach((v, i) => finite(v, `positions[${i}]`));
  const revision = nextStructureRevision(data.identity);
  return Object.freeze({
    ...data,
    positions: positions.slice(),
    revision: Object.freeze({ ...data.revision, positions: revision }),
  });
}
