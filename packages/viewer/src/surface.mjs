import { use, useMemo } from '@use-gpu/live';
import { FaceLayer } from '@use-gpu/workbench';
import { activeAtoms } from '@molgpu/table';
import { useStructure } from './structure-context.mjs';
import { withColumns } from './internal/representation.mjs';
import { checkOpacity, applyOpacity, flatAlpha, modeProps } from './internal/opacity.mjs';
import { withMaterial } from './materials.mjs';
import { useGeometryJob } from './use-geometry-job.mjs';
import { buildSurfaceGeometry } from './internal/surface-geometry.mjs';
import { useRepaint } from './internal/use-repaint.mjs';
import { count } from './internal/instrumentation.mjs';
import { useBindingProbe } from './internal/use-binding-probe.mjs';

/**
 * A molecular (solvent-excluded) surface: Mol*'s scalar-field kernel lifted
 * through @molgpu/io, extracted with @molgpu/geo's marching-cubes port, and
 * drawn via FaceLayer. `select` (a @molgpu/select atom Selection) restricts
 * which atoms build the surface; without one, the active model/primary-
 * altloc atoms are used. `probeRadius`/`resolution` are the only geometry
 * parameters — changing either rebuilds the field and mesh (routed through
 * 0sj.7's useGeometryJob, so a rapid parameter change displays only the
 * latest result and unmounting cancels outstanding work); `color`/`opacity`
 * are separate FaceLayer bindings and never do. An oversize grid throws an
 * actionable error (see internal/geometry-job.mjs's assertGridBudget)
 * before the field is computed, not after. Each vertex carries the atom row
 * it is nearest to (`sourceAtom` on the raw geometry, not yet surfaced as a
 * prop here — picking/field colouring is future work built on top of it).
 * `material` (a @molgpu/viewer material spec) wraps the shaded face layer;
 * without one the surface uses the ambient scene material.
 */
export const Surface = ({ select, probeRadius = 1.4, resolution = 0.5, maxBytes, color = [0.75, 0.75, 0.8, 1], opacity = 1, mode, material, loading = null, error = null, ...props }) => {
  useRepaint();
  useBindingProbe('surface', color, opacity);
  checkOpacity(opacity, 'Surface');
  const drawColor = useMemo(() => applyOpacity(color, opacity), [color, opacity]);
  const drawMode = modeProps(mode, flatAlpha(color, false) * opacity);
  const { resource } = useStructure();
  const { data } = resource;

  if (select !== undefined && select !== null && (select.dataset !== resource.identity || select.domain !== 'atom')) {
    throw new TypeError('Surface received a foreign or non-atom selection');
  }
  const selectKey = select?.id ?? 'active';
  const indices = useMemo(() => select ? select.indices : (count('topologyBuilds', 'surface:activeAtoms'), activeAtoms(data)), [data, selectKey]);
  const params = useMemo(() => ({ indices, probeRadius, resolution, maxBytes }), [indices, probeRadius, resolution, maxBytes]);
  const [mesh, failure, pending] = useGeometryJob(resource, params, buildSurfaceGeometry);

  if (pending) return typeof loading === 'function' ? loading() : loading;
  if (failure) return typeof error === 'function' ? error(failure) : error;
  if (!mesh?.vertexCount) return null;

  const specs = [
    { key: 'positions', data: mesh.positions, format: 'vec3<f32>' },
    { key: 'normals', data: mesh.normals, format: 'vec3<f32>' },
    { key: 'indices', data: mesh.indices, format: 'u32' },
  ];
  return withColumns(specs, (map) => withMaterial(material, use(FaceLayer, {
    positions: map.positions, normals: map.normals, indices: map.indices,
    color: drawColor, shaded: true, side: 'both', ...drawMode, ...props,
  })));
};
