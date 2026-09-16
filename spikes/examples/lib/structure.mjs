// <Structure> — the data intermediary.
//
// It owns the one job nothing else should have to think about: turning a
// columnar CPU table into GPU sources, once, and publishing them by CONTEXT so
// representations pull what they need instead of having data threaded in.
//
// This is what replaces the nested RawData pyramid in the examples.
//
// KEY CONSTRAINT: hooks must run in a stable order every evaluation, so the set
// of uploaded columns is STATIC (see COLUMNS). A column that is absent from the
// table still consumes its hook slot via useNoRawSource(). That is why this is a
// fixed schema rather than "upload whatever keys the table happens to have".
import { makeContext, provide, useContext, useMemo } from '@use-gpu/live';
import { useRawSource, useNoRawSource } from '@use-gpu/workbench';

/** The fixed column schema. Order matters — it is the hook order. */
const COLUMNS = [
  ['positions', 'vec3<f32>'],
  ['radius',    'f32'],
  ['colors',    'vec4<f32>'],
  ['element',   'u32'],
];

/**
 * Plain (non-hook) bounds, so callers outside the component tree — camera
 * framing, tests — can use it too. This is the shape focus(selection) will take.
 */
export function computeBounds(table) {
  const { positions, count } = table;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
    const v = positions[i*3 + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  const center = min.map((v, k) => (v + max[k]) / 2);
  const extent = Math.max(...min.map((v, k) => max[k] - v));
  return { min, max, center, extent };
}

export const StructureContext = makeContext(null, 'Structure');

export const useStructure = () => {
  const ctx = useContext(StructureContext);
  if (!ctx) throw new Error('useStructure() requires a <Structure> ancestor');
  return ctx;
};

export const Structure = ({ table, children }) => {
  // One hook per column, always the same order, present or not.
  const sources = {};
  for (const [name, format] of COLUMNS) {
    const column = table[name];
    if (column) sources[name] = useRawSource(column, format);
    else { useNoRawSource(); sources[name] = null; }
  }

  // Bounds live here because the structure is what knows its own extent.
  // Framing derives from this (and later from selections — CONCEPT 6).
  const bounds = useMemo(() => computeBounds(table), [table]);

  // useOne takes a SINGLE dep; passing an array to it re-runs every evaluation.
  // useMemo is the one that takes a dependency list.
  const value = useMemo(() => ({ table, count: table.count, sources, bounds }),
                        [table, bounds]);

  return provide(StructureContext, value, children);
};
