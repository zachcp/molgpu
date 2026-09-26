import type { Field } from '@molgpu/fields';
import type { Selection } from '@molgpu/select';
import type { MaterialSpec, PointLayerOptions, Translucency, VectorLike, ViewerComponent } from './types.ts';
import { use, useMemo, type LC } from '@use-gpu/live';
import type { StorageSource } from '@use-gpu/core';
import type { ShaderSource } from '@use-gpu/shader';
import type { StructureData } from '@molgpu/table';
import { WorldSpacePointLayer } from './world-space-points.ts';
import { useStructure } from './structure-context.ts';
import { useField } from './use-field.ts';
import { isField, fieldAttrNames, withColumns, type ColumnMap, type ColumnSpec } from './internal/representation.ts';

/** Point-layer props Spacefill forwards to its layer (flags, draw mode, picking id). */
type LayerProps = PointLayerOptions & { mode?: 'opaque' | 'transparent'; id?: number };
/** An atom column readable by name (the attribute columns a field reads). */
const atomColumn = (data: StructureData, name: string): ArrayLike<number> =>
  data.topology.atoms[name as keyof StructureData['topology']['atoms']] as ArrayLike<number>;
import { checkOpacity, applyOpacity, flatAlpha, modeProps } from './internal/opacity.ts';
import { useOpacityColors } from './internal/use-opacity-colors.ts';
import { withMaterial } from './materials.ts';
import { Pickable } from './picking.ts';
import { useRepaint } from './internal/use-repaint.ts';
import { count } from './internal/instrumentation.ts';
import { useBindingProbe } from './internal/use-binding-probe.ts';

/** Selected positions: the only gathered column a coordinate edit changes. */
const gatherPositions = (data: StructureData, indices: Uint32Array): Float32Array => {
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
const gatherRadii = (data: StructureData, indices: Uint32Array): Float32Array => {
  count('gathers', 'spacefill:radii');
  const R = data.topology.atoms.radius!;
  return Float32Array.from(indices, (i) => R[i]);
};

const gatherAttributes = (data: StructureData, indices: Uint32Array | null, names: readonly string[]): Record<string, Float32Array> => Object.fromEntries(names.map((name) => {
  count('gathers', `spacefill:attr:${name}`);
  const column = atomColumn(data, name);
  const values = indices ? Float32Array.from(indices, (i) => column[i]) : Float32Array.from(column);
  return [name, values];
}));

// A field always colours here, so useField is called unconditionally.
const FieldPoints: LC<{
  positions: ShaderSource; sources: ColumnMap; radii: Float32Array; count: number;
  field: Field; opacity: number; scale: number;
} & LayerProps> = ({ positions, sources, radii, count, field, opacity, scale, ...props }) => {
  const colors = useOpacityColors(useField(field, sources as Record<string, ShaderSource>, { domain: 'atom' }), opacity);
  return use(WorldSpacePointLayer, { positions, colors, radii, count, scale, shape: 'circle', shaded: true, ...props });
};

// Owns the gathers and column uploads. Positions follow the dataset; radii and
// attribute columns follow topology, selection and the set of column names.
const GatheredSpacefill: LC<{
  data: StructureData; identity: StructureData['identity']; topologyRevision: number;
  indices: Uint32Array | null; selectKey: string; attrNames: readonly string[];
  field: Field | null; opacity: number; sharedPositions: StorageSource; color: unknown; scale: number;
} & LayerProps> = ({ data, identity, topologyRevision, indices, selectKey, attrNames, field, opacity, sharedPositions, color, scale, ...props }) => {
  const n = indices ? indices.length : data.topology.atoms.count;
  const positions = useMemo(() => indices ? gatherPositions(data, indices) : null, [data, selectKey]);
  const radii = useMemo(() => indices ? gatherRadii(data, indices) : data.topology.atoms.radius!, [identity, topologyRevision, selectKey]);
  const attrs = useMemo(() => gatherAttributes(data, indices, attrNames), [identity, topologyRevision, selectKey, attrNames.join()]);
  const specs: ColumnSpec[] = [];
  if (indices) specs.push({ key: 'positions', data: positions!, format: 'vec3<f32>' });
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
export const Spacefill: ViewerComponent<{
  /** Multiplies each atom's Ångström radius; defaults to 1. */
  scale?: number;
  /** A @molgpu/select atom Selection for this structure; restricts the draw. */
  select?: Selection | null;
  /** A flat colour, or a @molgpu/fields Field composed shader-side per atom. */
  color?: VectorLike | Field;
  /** Wraps the shaded point layer; without one, the ambient scene material. */
  material?: MaterialSpec;
  /** Draw the atoms into the picking buffer so usePicking() can resolve them
   *  (needs a <PickingProvider> and a <Pass picking>). Defaults to false. */
  pickable?: boolean;
} & Translucency & PointLayerOptions> = ({ scale = 1, select, color = [0.72, 0.72, 0.76, 1], opacity = 1, mode, material, pickable = false, ...props }) => {
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
  const flatColor = useMemo(() => field ? color : applyOpacity(color as VectorLike, opacity), [field, color, opacity]);
  const drawMode = modeProps(mode, flatAlpha(color, !!field) * opacity);

  const indices = select ? select.indices : null;
  const n = indices ? indices.length : data.topology.atoms.count;
  if (!sources || n === 0) return null;

  // Build the shaded layer, given the picking id to draw under (undefined when
  // not pickable → PointLayer emits no picking id). The whole-structure flat
  // path keeps the shared, already-uploaded source; both paths forward `id`.
  const draw = (id: number | undefined) => withMaterial(material, (!indices && !field)
    ? use(WorldSpacePointLayer, {
        positions: sources.positions, radii: data.topology.atoms.radius!, count: n,
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
