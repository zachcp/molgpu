import { use, type LiveElement } from '@use-gpu/live';
import { useStructure } from './structure-context.ts';
import { WorldSpacePointLayer } from './world-space-points.ts';
import type { Color, ViewerComponent } from './types.ts';

export interface PointsProps { readonly scale?: number; readonly color?: Color }

/** Every atom as a world-space shaded sphere (a spike-sized <Spacefill>). */
export const Points: ViewerComponent<PointsProps> = ({ scale = 1, color = [0.72, 0.72, 0.76, 1] }: PointsProps): LiveElement => {
  const { resource, sources } = useStructure();
  const radii = resource.data.topology.atoms.radius;
  if (!sources || !radii) return null;
  return use(WorldSpacePointLayer, { positions: sources.positions, radii, scale, color: [...color], shape: 'circle', shaded: true });
};
