// Identity-keyed annotation joins (molgpu-sept-urn.4). External per-residue or
// per-chain records are matched onto the table by an explicit identity policy —
// chain plus residue discriminators, NEVER a raw sequence number alone — and
// lifted to a per-atom `annotation` field that is indistinguishable from any
// other field. This is pure CPU work; there is no WGSL compilation here.
import { SCALAR, COLOR, annotation } from './index.mjs';

const fail = (field, message) => { throw new TypeError(`@molgpu/fields ${field}: ${message}`); };

/** Full residue identity as a plain object (mirrors table.residueKey fields). */
export function residueIdentity(data, r) {
  const { residues, chains } = data.topology;
  const c = residues.chain[r];
  return {
    model: chains.model[c], chainLabel: chains.labelId[c], chainAuth: chains.authId[c],
    labelSeq: residues.labelSeq[r], authSeq: residues.authSeq[r],
    insCode: residues.insertionCode[r], comp: residues.comp[r],
  };
}

/** Chain identity as a plain object. */
export function chainIdentity(data, c) {
  const { chains } = data.topology;
  return { model: chains.model[c], chainLabel: chains.labelId[c], chainAuth: chains.authId[c] };
}

const CHAIN_FIELDS = ['chainLabel', 'chainAuth'];

/** Canonical string key over the chosen identity fields. */
export const identityKey = (identity, fields) => JSON.stringify(fields.map((f) => identity[f] ?? null));

/**
 * Join external `records` onto `data` and return an `annotation` Field.
 *
 * `records` is an array whose entries carry the identity fields named in
 * `fields` plus a value (via `value`, default `r => r.value`). Matching is by
 * `fields`, which must include a chain field so a bare sequence number can never
 * be the whole key. Rows with no record are `missing` (policy `fallback` or
 * `fail`); records that collide on a key follow `duplicate` (`error`/`first`/
 * `last`). A residue/chain annotation is lifted to atoms unless `lift` is false.
 */
export function joinAnnotation(data, records, {
  domain = 'residue', fields, value = (r) => r.value, type = SCALAR,
  policy = 'fallback', fallback, duplicate = 'error', lift = true,
} = {}) {
  if (!Array.isArray(records)) fail('joinAnnotation.records', 'expected an array of records');
  if (!['residue', 'chain'].includes(domain)) fail('joinAnnotation.domain', 'expected residue or chain');
  if (!Array.isArray(fields) || !fields.length) fail('joinAnnotation.fields', 'expected a non-empty identity field list');
  if (!fields.some((f) => CHAIN_FIELDS.includes(f))) {
    fail('joinAnnotation.fields', `must include a chain field (${CHAIN_FIELDS.join(' or ')}); a sequence number alone is not a valid key`);
  }
  if (!['error', 'first', 'last'].includes(duplicate)) fail('joinAnnotation.duplicate', 'expected error, first, or last');

  // Index records by identity key, applying the duplicate policy.
  const byKey = new Map();
  for (const record of records) {
    const key = identityKey(record, fields);
    if (byKey.has(key)) {
      if (duplicate === 'error') fail('joinAnnotation', `duplicate annotation for key ${key}`);
      if (duplicate === 'first') continue;
    }
    byKey.set(key, value(record));
  }

  const identityOf = domain === 'residue' ? residueIdentity : chainIdentity;
  const rowCount = domain === 'residue' ? data.topology.residues.count : data.topology.chains.count;

  // Resolve a value (or absence) for each row of the record domain.
  const rowValue = new Array(rowCount);
  const rowPresent = new Uint8Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    const key = identityKey(identityOf(data, row), fields);
    if (byKey.has(key)) { rowValue[row] = byKey.get(key); rowPresent[row] = 1; }
  }

  // Lift residue/chain rows onto atoms, or keep the record domain.
  const targetDomain = lift ? 'atom' : domain;
  const rowOfAtom = (i) => domain === 'residue'
    ? data.topology.atoms.residue[i]
    : data.topology.residues.chain[data.topology.atoms.residue[i]];
  const n = lift ? data.topology.atoms.count : rowCount;
  const rowFor = lift ? rowOfAtom : ((i) => i);

  const c = type === COLOR ? 4 : 1;
  const values = new Float32Array(n * c);
  const missing = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const row = rowFor(i);
    if (rowPresent[row]) {
      missing[i] = 1;
      if (c === 1) values[i] = rowValue[row]; else values.set(rowValue[row], i * c);
    }
  }
  return annotation(targetDomain, type, values, { missing, policy, fallback });
}
