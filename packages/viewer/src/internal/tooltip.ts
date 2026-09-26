import { evaluate, type Field } from "@molgpu/fields";
import type { StructureData } from "@molgpu/table";

type Column = Float32Array | string[];
/** One atom's value for a tooltip: a scalar, a vector (colour) or a label. */
export type TooltipValue = number | number[] | string;

// @molgpu/fields' CPU `evaluate` runs over a whole domain. A tooltip reads a
// single atom but a hover fires that read repeatedly, so memoise each field's
// evaluated column per (field, data, time). String fields (labels) evaluate
// CPU-only, which is exactly what a tooltip wants.
const cache = new WeakMap<Field, WeakMap<StructureData, Map<number, Column>>>();
const columnFor = (field: Field, data: StructureData, t: number): Column => {
  let byData = cache.get(field);
  if (!byData) cache.set(field, byData = new WeakMap());
  let byTime = byData.get(data);
  if (!byTime) byData.set(data, byTime = new Map());
  let values = byTime.get(t);
  if (!values) {
    byTime.set(t, values = evaluate(field, data, { t, domain: "atom" }));
  }
  return values;
};

/** One field's value for a single atom row, unpacked from its evaluated column. */
const rowValue = (field: Field, values: Column, atom: number): TooltipValue => {
  if (field.type.kind === "string") return (values as string[])[atom];
  const c = field.type.components;
  const numbers = values as Float32Array;
  if (c === 1) return numbers[atom];
  return Array.from(numbers.subarray(atom * c, atom * c + c));
};

/**
 * Read a set of @molgpu/fields for one picked atom, for a tooltip. `fields` is a
 * record of `label -> Field` (each an atom-domain field); the result is a record
 * of the same labels mapped to the atom's value — a number for a scalar field,
 * a number[] for a colour/vector field, a string for a string field. `t` is the
 * timeline time for any time-dependent field (default 0). Evaluations are cached
 * per (field, data, t), so hovering many atoms of one structure stays cheap.
 */
export function tooltipFields(
  fields: Record<string, Field>,
  data: StructureData,
  atom: number,
  options: { t?: number } = {},
): Record<string, number | number[] | string> {
  const { t = 0 } = options;
  if (!fields || typeof fields !== "object") {
    throw new TypeError(
      "tooltipFields: fields must be a { label: Field } record",
    );
  }
  if (!Number.isInteger(atom) || atom < 0) {
    throw new TypeError(
      "tooltipFields: atom must be a nonnegative integer row",
    );
  }
  const out: Record<string, TooltipValue> = {};
  for (const [label, field] of Object.entries(fields)) {
    out[label] = rowValue(field, columnFor(field, data, t), atom);
  }
  return out;
}
