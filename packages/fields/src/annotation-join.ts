// Identity-keyed annotation joins. External per-residue or
// per-chain records are matched onto the table by an explicit identity policy —
// chain plus residue discriminators, NEVER a raw sequence number alone — and
// lifted to a per-atom `annotation` field that is indistinguishable from any
// other field. This is pure CPU work; there is no WGSL compilation here.
import type { StructureData } from "@molgpu/table";
import { annotation, COLOR, SCALAR } from "./construction.ts";
import type {
  ChainIdentity,
  Color,
  Field,
  IdentityField,
  ResidueIdentity,
  ValueType,
} from "./types.ts";

function fail(field: string, message: string): never {
  throw new TypeError(`@molgpu/fields ${field}: ${message}`);
}

/** Full residue identity as a plain object (mirrors table.residueKey fields). */
export function residueIdentity(
  data: StructureData,
  row: number,
): ResidueIdentity {
  const r = row;
  const { residues, chains } = data.topology;
  const c = residues.chain[r];
  return {
    model: chains.model[c],
    chainLabel: chains.labelId[c],
    chainAuth: chains.authId[c],
    labelSeq: residues.labelSeq[r],
    authSeq: residues.authSeq[r],
    insCode: residues.insertionCode[r],
    comp: residues.comp[r],
  };
}

/** Chain identity as a plain object. */
export function chainIdentity(data: StructureData, row: number): ChainIdentity {
  const c = row;
  const { chains } = data.topology;
  return {
    model: chains.model[c],
    chainLabel: chains.labelId[c],
    chainAuth: chains.authId[c],
  };
}

const CHAIN_FIELDS: readonly IdentityField[] = ["chainLabel", "chainAuth"];

/** Canonical string key over the chosen identity fields. */
export const identityKey = (
  identity: Partial<Record<IdentityField, unknown>>,
  fields: readonly IdentityField[],
): string => JSON.stringify(fields.map((f) => identity[f] ?? null));

/**
 * Join external `records` onto `data` and return an `annotation` Field.
 *
 * `records` is an array whose entries carry the identity fields named in
 * `fields` plus a value (via `value`, default `r => r.value`). Matching is by
 * `fields`, which must include a chain field so a bare sequence number can never
 * be the whole key. Rows with no record are `missing` (policy `fallback` or
 * `fail`); records that collide on a key follow `duplicate` (`error`/`first`/
 * `last`). Residue annotations lift to atoms by default; `lift: false` retains
 * residue rows. Chain annotations require lifting because fields have only atom
 * and residue domains. Include model and insertion-code fields when needed to
 * distinguish records.
 */
export function joinAnnotation<R>(
  data: StructureData,
  records: readonly R[],
  options: {
    domain?: "residue" | "chain";
    fields: readonly IdentityField[];
    value?: (record: R) => number | Color;
    type?: ValueType;
    policy?: "fallback" | "fail";
    fallback?: number | Color;
    duplicate?: "error" | "first" | "last";
    lift?: boolean;
  },
): Field {
  const {
    domain = "residue",
    fields,
    value = (r: R) => (r as { value: number | Color }).value,
    type = SCALAR,
    policy = "fallback",
    fallback,
    duplicate = "error",
    lift = true,
  } = options;
  if (!Array.isArray(records)) {
    fail("joinAnnotation.records", "expected an array of records");
  }
  if (!["residue", "chain"].includes(domain)) {
    fail("joinAnnotation.domain", "expected residue or chain");
  }
  if (!Array.isArray(fields) || !fields.length) {
    fail("joinAnnotation.fields", "expected a non-empty identity field list");
  }
  if (!fields.some((f) => CHAIN_FIELDS.includes(f))) {
    fail(
      "joinAnnotation.fields",
      `must include a chain field (${
        CHAIN_FIELDS.join(" or ")
      }); a sequence number alone is not a valid key`,
    );
  }
  if (!["error", "first", "last"].includes(duplicate)) {
    fail("joinAnnotation.duplicate", "expected error, first, or last");
  }

  // Index records by identity key, applying the duplicate policy.
  const byKey = new Map<string, number | Color>();
  for (const record of records) {
    const key = identityKey(
      record as Partial<Record<IdentityField, unknown>>,
      fields,
    );
    if (byKey.has(key)) {
      if (duplicate === "error") {
        fail("joinAnnotation", `duplicate annotation for key ${key}`);
      }
      if (duplicate === "first") continue;
    }
    byKey.set(key, value(record));
  }

  const identityOf: (
    data: StructureData,
    row: number,
  ) => Partial<Record<IdentityField, unknown>> = domain === "residue"
    ? residueIdentity
    : chainIdentity;
  const rowCount = domain === "residue"
    ? data.topology.residues.count
    : data.topology.chains.count;

  // Resolve a value (or absence) for each row of the record domain.
  const rowValue = new Array<number | Color>(rowCount);
  const rowPresent = new Uint8Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    const key = identityKey(identityOf(data, row), fields);
    if (byKey.has(key)) {
      rowValue[row] = byKey.get(key)!;
      rowPresent[row] = 1;
    }
  }

  // Lift residue/chain rows onto atoms, or keep the record domain.
  const targetDomain = lift ? "atom" : domain;
  const rowOfAtom = (i: number): number =>
    domain === "residue"
      ? data.topology.atoms.residue[i]
      : data.topology.residues.chain[data.topology.atoms.residue[i]];
  const n = lift ? data.topology.atoms.count : rowCount;
  const rowFor = lift ? rowOfAtom : ((i: number): number => i);

  const c = type === COLOR ? 4 : 1;
  const values = new Float32Array(n * c);
  const missing = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const row = rowFor(i);
    if (rowPresent[row]) {
      missing[i] = 1;
      if (c === 1) values[i] = rowValue[row] as number;
      else values.set(rowValue[row] as Color, i * c);
    }
  }
  return annotation(targetDomain as "atom" | "residue", type, values, {
    missing,
    policy,
    fallback,
  });
}
