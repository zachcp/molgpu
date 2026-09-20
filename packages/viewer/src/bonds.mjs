import { use, useMemo } from '@use-gpu/live';
import { LineLayer } from '@use-gpu/workbench';
import { bondTopology } from '@molgpu/table';
import { useStructure } from './structure-context.mjs';
import { useField } from './use-field.mjs';
import { isField, fieldAttrNames, withColumns } from './internal/representation.mjs';

// Bonds live at a different cardinality than atoms — two endpoint vertices per
// bond — so this derives and uploads its own columns rather than reusing the
// per-atom sources. Each bond is its own [1,2] start/end run, so `shaded`+`sides`
// extrudes a real world-space cylinder (depth:-1) instead of a flat strip.
const buildEndpoints = (data, indices, endpoints, attrNames) => {
  const bonds = bondTopology(data);
  const keep = indices ? new Set(indices) : null;
  const rows = [];                                   // endpoint atom indices, 2 per kept bond
  for (let b = 0; b < bonds.count; b++) {
    const i = bonds.a[b], j = bonds.b[b];
    const keptBond = !keep ? true
      : endpoints === 'either' ? (keep.has(i) || keep.has(j)) : (keep.has(i) && keep.has(j));
    if (keptBond) rows.push(i, j);
  }
  const n = rows.length;
  const positions = new Float32Array(n * 3);
  const segments = new Int32Array(n);                // MUST be i32; [1,2] = discrete strokes
  const attrs = Object.fromEntries(attrNames.map((name) => [name, new Float32Array(n)]));
  for (let k = 0; k < n; k++) {
    const i = rows[k];
    positions[k * 3] = data.positions[i * 3];
    positions[k * 3 + 1] = data.positions[i * 3 + 1];
    positions[k * 3 + 2] = data.positions[i * 3 + 2];
    segments[k] = k % 2 === 0 ? 1 : 2;
    for (const name of attrNames) attrs[name][k] = data.topology.atoms[name][i];
  }
  return { n, positions, segments, attrs };
};

const line = (positions, segments, width, sides, shaded, extra, props) =>
  use(LineLayer, { positions, segments, width, join: 'round', ...(shaded ? { shaded: true, sides, depth: -1 } : {}), ...extra, ...props });

// A colour field colours each endpoint by its atom, composed shader-side.
const FieldBonds = ({ map, field, width, sides, shaded, ...props }) => {
  const colors = useField(field, map, { domain: 'atom' });
  return line(map.positions, map.segments, width, sides, shaded, { colors }, props);
};

/**
 * Draw bonds as world-space sticks. `select` (a @molgpu/select atom Selection)
 * keeps bonds whose endpoints satisfy `endpoints` ('both', the default, or
 * 'either'); the endpoint policy is explicit and documented. `color` is a flat
 * colour or a @molgpu/fields Field, composed shader-side per endpoint atom.
 * Connectivity comes from the shared bond topology (explicit, else inferred).
 */
export const Bonds = ({ width = 0.3, select, color = [0.72, 0.72, 0.76, 1], endpoints = 'both', sides = 6, shaded = true, ...props }) => {
  const { resource } = useStructure();
  const { data } = resource;

  if (select !== undefined && select !== null && (select.dataset !== resource.identity || select.domain !== 'atom')) {
    throw new TypeError('Bonds received a foreign or non-atom selection');
  }
  if (!['both', 'either'].includes(endpoints)) throw new TypeError("Bonds endpoints must be 'both' or 'either'");
  const field = isField(color) ? color : null;
  const attrNames = useMemo(() => fieldAttrNames(field), [field]);
  const indices = select ? select.indices : null;
  const built = useMemo(() => buildEndpoints(data, indices, endpoints, attrNames),
    [data, select?.id ?? 'all', endpoints, attrNames]);
  if (!built.n) return null;

  const specs = [
    { key: 'positions', data: built.positions, format: 'vec3<f32>' },
    { key: 'segments', data: built.segments, format: 'i32' },
    ...attrNames.map((name) => ({ key: `attr:${name}`, data: built.attrs[name], format: 'f32' })),
  ];
  return withColumns(specs, (map) => field
    ? use(FieldBonds, { map, field, width, sides, shaded, ...props })
    : line(map.positions, map.segments, width, sides, shaded, { color }, props));
};
