import { use, useMemo } from '@use-gpu/live';
import { WorldSpacePointLayer } from './world-space-points.mjs';
import { useStructure } from './structure-context.mjs';
import { useField } from './use-field.mjs';
import { isField, fieldAttrNames, withColumns } from './internal/representation.mjs';
import { checkOpacity, applyOpacity, flatAlpha, modeProps } from './internal/opacity.mjs';
import { useOpacityColors } from './internal/use-opacity-colors.mjs';
import { withMaterial } from './materials.mjs';
import { Pickable } from './picking.mjs';
import { useRepaint } from './internal/use-repaint.mjs';
import { count } from './internal/instrumentation.mjs';
import { useBindingProbe } from './internal/use-binding-probe.mjs';

/** Selected positions: the only gathered column a coordinate edit changes. */
const gatherPositions = (data, indices) => {
  count('gathers', 'spacefill:atoms');
  const positions = new Float32Array(indices.length * 3);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    positions[k * 3] = data.positions[i * 3];
    positions[k * 3 + 1] = data.positions[i * 3 + 1];
    positions[k * 3 + 2] = data.positions[i * 3 + 2];
  }
  return positions;
};

/** Selected radii depend on topology and selection only, so they (and the
 * point sizes derived from them) survive coordinate edits. */
const gatherRadii = (data, indices) => {
  count('gathers', 'spacefill:radii');
  const R = data.topology.atoms.radius;
  return Float32Array.from(indices, (i) => R[i]);
};

const gatherAttributes = (data, indices, names) => Object.fromEntries(names.map((name) => {
  count('gathers', `spacefill:attr:${name}`);
  const column = data.topology.atoms[name];
  const values = indices ? Float32Array.from(indices, (i) => column[i]) : Float32Array.from(column);
  return [name, values];
}));

// A field always colours here, so useField is called unconditionally.
const FieldPoints = ({ positions, sources, radii, count, field, opacity, scale, ...props }) => {
  const colors = useOpacityColors(useField(field, sources, { domain: 'atom' }), opacity);
  return use(WorldSpacePointLayer, { positions, colors, radii, count, scale, shape: 'circle', shaded: true, ...props });
};

// Owns the gathers and column uploads. Positions follow the dataset; radii and
// attribute columns follow topology, selection and the set of column names.
const GatheredSpacefill = ({ data, identity, topologyRevision, indices, selectKey, attrNames, field, opacity, sharedPositions, color, scale, ...props }) => {
  const n = indices ? indices.length : data.topology.atoms.count;
  const positions = useMemo(() => indices ? gatherPositions(data, indices) : null, [data, selectKey]);
  const radii = useMemo(() => indices ? gatherRadii(data, indices) : data.topology.atoms.radius, [identity, topologyRevision, selectKey]);
  const attrs = useMemo(() => gatherAttributes(data, indices, attrNames), [identity, topologyRevision, selectKey, attrNames.join()]);
  const specs = [];
  if (indices) specs.push({ key: 'positions', data: positions, format: 'vec3<f32>' });
  for (const name of attrNames) specs.push({ key: `attr:${name}`, data: attrs[name], format: 'f32' });
  return withColumns(specs, (map) => {
    const positions = indices ? map.positions : sharedPositions;
    if (!positions) return null;
    return field
      ? use(FieldPoints, { positions, sources: map, radii, count: n, field, opacity, scale, ...props })
      : use(WorldSpacePointLayer, { positions, radii, count: n, scale, color, shape: 'circle', shaded: true, ...props });
  });
};

/**
 * Render active atom sites as world-space shaded spheres. `select` (a
 * @molgpu/select atom Selection) restricts to a subset, gathered once per
 * selection change. `color` is either a flat colour or a @molgpu/fields Field,
 * which is composed shader-side over the atoms' columns (no per-atom colour
 * upload) via the viewer's useField. `material` (a @molgpu/viewer material
 * spec) wraps the shaded point layer; without one the atoms use the ambient
 * scene material. `opacity` (0–1) multiplies the colour's alpha — a uniform,
 * so fading never touches geometry — and below 1 the atoms draw in transparent
 * mode (pair with <Pass oit>); an explicit `mode` overrides. `pickable` draws the atoms into the picking buffer so
 * usePicking() can resolve the cursor to an atom row (needs a <PickingProvider>
 * and a <Pass picking>).
 */
export const Spacefill = ({ scale = 1, select, color = [0.72, 0.72, 0.76, 1], opacity = 1, mode, material, pickable = false, ...props }) => {
  useRepaint();
  useBindingProbe('spacefill', color, opacity, scale);
  const { resource, sources } = useStructure();
  const { data } = resource;

  if (select !== undefined && select !== null && (select.dataset !== resource.identity || select.domain !== 'atom')) {
    throw new TypeError('Spacefill received a foreign or non-atom selection');
  }
  const field = isField(color) ? color : null;
  // A colour field names the atom columns it reads; gather exactly those.
  const attrNames = useMemo(() => fieldAttrNames(field), [field]);
  checkOpacity(opacity, 'Spacefill');
  const flatColor = useMemo(() => field ? color : applyOpacity(color, opacity), [field, color, opacity]);
  const drawMode = modeProps(mode, flatAlpha(color, !!field) * opacity);

  const indices = select ? select.indices : null;
  const n = indices ? indices.length : data.topology.atoms.count;
  if (!sources || n === 0) return null;

  // Build the shaded layer, given the picking id to draw under (undefined when
  // not pickable → PointLayer emits no picking id). The whole-structure flat
  // path keeps the shared, already-uploaded source; both paths forward `id`.
  const draw = (id) => withMaterial(material, (!indices && !field)
    ? use(WorldSpacePointLayer, {
        positions: sources.positions, radii: data.topology.atoms.radius, count: n,
        scale, color: flatColor, shape: 'circle', shaded: true, id, ...drawMode, ...props,
      })
    : use(GatheredSpacefill, {
        data, identity: resource.identity, topologyRevision: resource.topologyRevision, indices, selectKey: select?.id ?? 'all', attrNames, field, opacity,
        sharedPositions: sources.positions, color: flatColor, scale, id, ...drawMode, ...props,
      }));

  // The drawn instance order is the gather order: for a selection that is
  // `indices`, otherwise identity (instance index === atom row).
  return pickable
    ? use(Pickable, { resource, indices, render: draw })
    : draw(undefined);
};
