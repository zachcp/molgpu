// Derived attributes and stable views over topology columns.
import type {
  AttributeColumn,
  AttributeColumnInput,
  AttributeDomain,
  AttributeValues,
  StructureData,
} from "./structure-types.ts";
import { isStructureIdentity, nextStructureRevision } from "./structure.ts";
import { legacySsCodes } from "./ss-codes.ts";

type Identity = StructureData["identity"];
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
  if (!isStructureIdentity(data.identity)) {
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
  const revision = nextStructureRevision(data.identity);
  return Object.freeze({
    ...data,
    attributes: Object.freeze(next),
    revision: Object.freeze({ ...data.revision, attributes: revision }),
  });
}
