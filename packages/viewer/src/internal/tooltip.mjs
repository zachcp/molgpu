import { evaluate } from '@molgpu/fields';

// @molgpu/fields' CPU `evaluate` runs over a whole domain. A tooltip reads a
// single atom but a hover fires that read repeatedly, so memoise each field's
// evaluated column per (field, data, time). String fields (labels) evaluate
// CPU-only, which is exactly what a tooltip wants.
const cache = new WeakMap(); // field -> WeakMap<data, Map<t, values>>
const columnFor = (field, data, t) => {
  let byData = cache.get(field);
  if (!byData) cache.set(field, (byData = new WeakMap()));
  let byTime = byData.get(data);
  if (!byTime) byData.set(data, (byTime = new Map()));
  let values = byTime.get(t);
  if (!values) byTime.set(t, (values = evaluate(field, data, { t, domain: 'atom' })));
  return values;
};

/** One field's value for a single atom row, unpacked from its evaluated column. */
const rowValue = (field, values, atom) => {
  if (field.type.kind === 'string') return values[atom];
  const c = field.type.components;
  if (c === 1) return values[atom];
  return Array.from(values.subarray(atom * c, atom * c + c));
};

/**
 * Read a set of @molgpu/fields for one picked atom, for a tooltip. `fields` is a
 * record of `label -> Field` (each an atom-domain field); the result is a record
 * of the same labels mapped to the atom's value — a number for a scalar field,
 * a number[] for a colour/vector field, a string for a string field. `t` is the
 * timeline time for any time-dependent field (default 0). Evaluations are cached
 * per (field, data, t), so hovering many atoms of one structure stays cheap.
 */
export const tooltipFields = (fields, data, atom, { t = 0 } = {}) => {
  if (!fields || typeof fields !== 'object') throw new TypeError('tooltipFields: fields must be a { label: Field } record');
  if (!Number.isInteger(atom) || atom < 0) throw new TypeError('tooltipFields: atom must be a nonnegative integer row');
  const out = {};
  for (const [label, field] of Object.entries(fields)) {
    out[label] = rowValue(field, columnFor(field, data, t), atom);
  }
  return out;
};
