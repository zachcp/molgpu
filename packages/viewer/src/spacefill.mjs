import { use, useMemo } from '@use-gpu/live';
import { WorldSpacePointLayer } from './world-space-points.mjs';
import { useStructure } from './structure-context.mjs';
import { useField } from './use-field.mjs';
import { isField, fieldAttrNames, withColumns } from './internal/representation.mjs';
import { withMaterial } from './materials.mjs';
import { Pickable } from './picking.mjs';
import { useRepaint } from './internal/use-repaint.mjs';
import { count } from './internal/instrumentation.mjs';
import { useBindingProbe } from './internal/use-binding-probe.mjs';

/** Geometry depends on structure and selection, never on the colour field. */
const gather = (data, indices) => {
  count('gathers', 'spacefill:atoms');
  const n = indices ? indices.length : data.topology.atoms.count;
  const positions = new Float32Array(n * 3);
  const radii = new Float32Array(n);
  const R = data.topology.atoms.radius;
  for (let k = 0; k < n; k++) {
    const i = indices ? indices[k] : k;
    positions[k * 3] = data.positions[i * 3];
    positions[k * 3 + 1] = data.positions[i * 3 + 1];
    positions[k * 3 + 2] = data.positions[i * 3 + 2];
    radii[k] = R[i];
  }
  return { n, positions, radii };
};

const gatherAttributes = (data, indices, names) => Object.fromEntries(names.map((name) => {
  count('gathers', `spacefill:attr:${name}`);
  const column = data.topology.atoms[name];
  const values = indices ? Float32Array.from(indices, (i) => column[i]) : Float32Array.from(column);
  return [name, values];
}));

// A field always colours here, so useField is called unconditionally.
const FieldPoints = ({ positions, sources, radii, count, field, scale, ...props }) => {
  const colors = useField(field, sources, { domain: 'atom' });
  return use(WorldSpacePointLayer, { positions, colors, radii, count, scale, shape: 'circle', shaded: true, ...props });
};

// Owns the gather (memoised by selection identity) and column uploads.
const GatheredSpacefill = ({ data, indices, selectKey, attrNames, field, sharedPositions, color, scale, ...props }) => {
  const gathered = useMemo(() => gather(data, indices), [data, selectKey]);
  const attrs = useMemo(() => gatherAttributes(data, indices, attrNames), [data, selectKey, attrNames]);
  const specs = [];
  if (indices) specs.push({ key: 'positions', data: gathered.positions, format: 'vec3<f32>' });
  for (const name of attrNames) specs.push({ key: `attr:${name}`, data: attrs[name], format: 'f32' });
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
 * upload) via the viewer's useField. `material` (a @molgpu/viewer material
 * spec) wraps the shaded point layer; without one the atoms use the ambient
 * scene material. `pickable` draws the atoms into the picking buffer so
 * usePicking() can resolve the cursor to an atom row (needs a <PickingProvider>
 * and a <Pass picking>).
 */
export const Spacefill = ({ scale = 1, select, color = [0.72, 0.72, 0.76, 1], material, pickable = false, ...props }) => {
  useRepaint();
  useBindingProbe('spacefill', color, scale);
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

  // Build the shaded layer, given the picking id to draw under (undefined when
  // not pickable → PointLayer emits no picking id). The whole-structure flat
  // path keeps the shared, already-uploaded source; both paths forward `id`.
  const draw = (id) => withMaterial(material, (!indices && !field)
    ? use(WorldSpacePointLayer, {
        positions: sources.positions, radii: data.topology.atoms.radius, count: n,
        scale, color, shape: 'circle', shaded: true, id, ...props,
      })
    : use(GatheredSpacefill, {
        data, indices, selectKey: select?.id ?? 'all', attrNames, field,
        sharedPositions: sources.positions, color, scale, id, ...props,
      }));

  // The drawn instance order is the gather order: for a selection that is
  // `indices`, otherwise identity (instance index === atom row).
  return pickable
    ? use(Pickable, { resource, indices, render: draw })
    : draw(undefined);
};
