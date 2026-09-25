import { use, useMemo } from '@use-gpu/live';
import { LineLayer } from '@use-gpu/workbench';
import { activeAtoms, traceTable } from '@molgpu/table';
import { useStructure } from './structure-context.mjs';
import { withColumns } from './internal/representation.mjs';
import { checkOpacity, applyOpacity, flatAlpha, modeProps } from './internal/opacity.mjs';
import { withMaterial } from './materials.mjs';
import { buildTubeGeometry } from './internal/tube-geometry.mjs';
import { lineWidthForRadius } from './internal/line-size.mjs';
import { useRepaint } from './internal/use-repaint.mjs';
import { count } from './internal/instrumentation.mjs';
import { useBindingProbe } from './internal/use-binding-probe.mjs';

/**
 * Draw the polymer backbone as a GPU-extruded tube: RawLines' shaded mode
 * (@use-gpu/wgsl/geometry/tube via LineLayer), zero CPU mesh building.
 * `select` (a @molgpu/select atom Selection) restricts which atoms feed the
 * trace; without one, the active model/primary-altloc atoms are used, never
 * every altloc conformer at once (which would jumble the guide path).
 * Missing residues, chain/model breaks, and a selection that drops a
 * residue's guide atom all end a run rather than being bridged across.
 * `radius` is an Ångström tube radius, converted through the verified
 * depth:-1 LineLayer width contract (internal/line-size.mjs) with no
 * empirical floor. Only `select` and `smooth` (samples per guide segment)
 * rebuild the trace/spline geometry; `radius` and `color` update bindings.
 */
export const Tube = ({ select, radius = 0.3, sides = 8, join = 'round', smooth = 6, color = [0.45, 0.78, 0.95, 1], opacity = 1, mode, material, ...props }) => {
  useRepaint();
  useBindingProbe('tube', color, opacity, radius);
  checkOpacity(opacity, 'Tube');
  const drawColor = useMemo(() => applyOpacity(color, opacity), [color, opacity]);
  const drawMode = modeProps(mode, flatAlpha(color, false) * opacity);
  const { resource } = useStructure();
  const { data } = resource;

  if (select !== undefined && select !== null && (select.dataset !== resource.identity || select.domain !== 'atom')) {
    throw new TypeError('Tube received a foreign or non-atom selection');
  }
  const selectKey = select?.id ?? 'active';
  // activeAtoms is a topology-only view policy: coordinate edits keep it.
  const indices = useMemo(() => select ? select.indices : (count('topologyBuilds', 'tube:activeAtoms'), activeAtoms(data)), [resource.identity, resource.topologyRevision, selectKey]);
  const trace = useMemo(() => (count('geometryBuilds', 'tube:trace'), traceTable(data, indices)), [data, indices]);
  const built = useMemo(() => buildTubeGeometry(trace, smooth), [trace, smooth]);
  if (!built.count) return null;

  const width = lineWidthForRadius(radius, -1);
  const specs = [
    { key: 'positions', data: built.positions, format: 'vec3<f32>' },
    { key: 'segments', data: built.segments, format: 'i32' },
  ];
  return withColumns(specs, (map) => withMaterial(material, use(LineLayer, {
    positions: map.positions, segments: map.segments, width, color: drawColor,
    shaded: true, sides, join, depth: -1, ...drawMode, ...props,
  })));
};
