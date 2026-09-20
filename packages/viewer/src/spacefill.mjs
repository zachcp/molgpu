import { use, useMemo } from '@use-gpu/live';
import { WorldSpacePointLayer } from './world-space-points.mjs';
import { useStructure } from './structure-context.mjs';
import { useField } from './use-field.mjs';
import { isField, fieldAttrNames, withColumns } from './internal/representation.mjs';

/** Copy the columns a selection touches into fresh packed arrays. */
const gather = (data, indices, attrNames) => {
  const n = indices ? indices.length : data.topology.atoms.count;
  const positions = new Float32Array(n * 3);
  const radii = new Float32Array(n);
  const attrs = Object.fromEntries(attrNames.map((name) => [name, new Float32Array(n)]));
  const R = data.topology.atoms.radius;
  for (let k = 0; k < n; k++) {
    const i = indices ? indices[k] : k;
    positions[k * 3] = data.positions[i * 3];
    positions[k * 3 + 1] = data.positions[i * 3 + 1];
    positions[k * 3 + 2] = data.positions[i * 3 + 2];
    radii[k] = R[i];
    for (const name of attrNames) attrs[name][k] = data.topology.atoms[name][i];
  }
  return { n, positions, radii, attrs };
};

// A field always colours here, so useField is called unconditionally.
const FieldPoints = ({ positions, sources, radii, count, field, scale, ...props }) => {
  const colors = useField(field, sources, { domain: 'atom' });
  return use(WorldSpacePointLayer, { positions, colors, radii, count, scale, shape: 'circle', shaded: true, ...props });
};

// Owns the gather (memoised by selection identity) and column uploads.
const GatheredSpacefill = ({ data, indices, selectKey, attrNames, field, sharedPositions, color, scale, ...props }) => {
  const gathered = useMemo(() => gather(data, indices, attrNames), [data, selectKey, attrNames]);
  const specs = [];
  if (indices) specs.push({ key: 'positions', data: gathered.positions, format: 'vec3<f32>' });
  for (const name of attrNames) specs.push({ key: `attr:${name}`, data: gathered.attrs[name], format: 'f32' });
  return withColumns(specs, (map) => {
    const positions = indices ? map.positions : sharedPositions;
    if (!positions) return null;
    return field
      ? use(FieldPoints, { positions, sources: map, radii: gathered.radii, count: gathered.n, field, scale, ...props })
      : use(WorldSpacePointLayer, { positions, radii: gathered.radii, count: gathered.n, scale, color, shape: 'circle', shaded: true, ...props });
  });
};

/**
 * Render active atom sites as world-space shaded spheres. `select` (a
 * @molgpu/select atom Selection) restricts to a subset, gathered once per
 * selection change. `color` is either a flat colour or a @molgpu/fields Field,
 * which is composed shader-side over the atoms' columns (no per-atom colour
 * upload) via the viewer's useField.
 */
export const Spacefill = ({ scale = 1, select, color = [0.72, 0.72, 0.76, 1], ...props }) => {
  const { resource, sources } = useStructure();
  const { data } = resource;

  if (select !== undefined && select !== null && (select.dataset !== resource.identity || select.domain !== 'atom')) {
    throw new TypeError('Spacefill received a foreign or non-atom selection');
  }
  const field = isField(color) ? color : null;
  // A colour field names the atom columns it reads; gather exactly those.
  const attrNames = useMemo(() => fieldAttrNames(field), [field]);

  const indices = select ? select.indices : null;
  const n = indices ? indices.length : data.topology.atoms.count;
  if (!sources || n === 0) return null;

  // Whole structure with a flat colour keeps the shared, already-uploaded source.
  if (!indices && !field) {
    return use(WorldSpacePointLayer, {
      positions: sources.positions, radii: data.topology.atoms.radius, count: n,
      scale, color, shape: 'circle', shaded: true, ...props,
    });
  }

  return use(GatheredSpacefill, {
    data, indices, selectKey: select?.id ?? 'all', attrNames, field,
    sharedPositions: sources.positions, color, scale, ...props,
  });
};
