import { use } from '@use-gpu/live';
import { WorldSpacePointLayer } from './world-space-points.mjs';
import { useStructure } from './structure-context.mjs';

/** Render all active atom sites as world-space shaded spheres.
 * A selection gather path belongs to @molgpu/select; until it is available,
 * passing select is rejected rather than silently drawing the wrong atoms. */
export const Spacefill = ({ scale = 1, select, color = [0.72, 0.72, 0.76, 1], ...props }) => {
  const { resource, sources } = useStructure();
  if (select !== undefined && select !== null) {
    if (!resource.accepts(select)) throw new TypeError('Spacefill received a foreign or stale selection');
    throw new Error('Spacefill selections require @molgpu/select');
  }
  if (!sources) return null;
  const { data } = resource;
  return use(WorldSpacePointLayer, {
    positions: sources.positions,
    radii: data.topology.atoms.radius,
    count: data.topology.atoms.count,
    scale,
    color,
    shape: 'circle',
    shaded: true,
    ...props,
  });
};
