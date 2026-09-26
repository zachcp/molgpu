import type { Field } from '@molgpu/fields';
import type { Selection } from '@molgpu/select';
import type { MaterialSpec, Translucency, VectorLike, ViewerComponent } from './types.ts';
import { use } from '@use-gpu/live';
import { Spacefill } from './spacefill.ts';
import { Bonds } from './bonds.ts';

/**
 * A composite representation that owns no drawing of its own: <Spacefill> balls
 * at a small radius plus <Bonds> sticks, both scoped to the SAME selection and
 * coloured by the SAME `color` (a flat colour or a @molgpu/fields Field). This
 * is the third Gate-2 consumer, and the payoff of the <Structure> intermediary —
 * composing representations needs no data plumbing.
 *
 * `ball` scales the van der Waals radius; `stick` is the world-space stick width.
 * A `material` (in `...props`) forwards to both halves, so balls and sticks
 * share one shading model, and `opacity`/`mode` (also in `...props`) fade both.
 */
export const BallAndStick: ViewerComponent<{
  select?: Selection | null;
  /** A flat colour or a @molgpu/fields Field, applied to balls and sticks. */
  color?: VectorLike | Field;
  /** Ball radius scale; defaults to 0.3. */
  ball?: number;
  /** Stick width; defaults to 0.28. */
  stick?: number;
  endpoints?: 'both' | 'either';
  /** Forwarded to both balls and sticks, so they share one shading model. */
  material?: MaterialSpec;
} & Translucency> = ({ select = null, color, ball = 0.3, stick = 0.28, endpoints = 'both', ...props }) => {
  const shared = color !== undefined ? { color } : {};
  return [
    use(Spacefill, { select, scale: ball, ...shared, ...props }),
    use(Bonds, { select, width: stick, endpoints, ...shared, ...props }),
  ];
};
