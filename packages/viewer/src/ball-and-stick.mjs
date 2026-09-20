import { use } from '@use-gpu/live';
import { Spacefill } from './spacefill.mjs';
import { Bonds } from './bonds.mjs';

/**
 * A composite representation that owns no drawing of its own: <Spacefill> balls
 * at a small radius plus <Bonds> sticks, both scoped to the SAME selection and
 * coloured by the SAME `color` (a flat colour or a @molgpu/fields Field). This
 * is the third Gate-2 consumer, and the payoff of the <Structure> intermediary —
 * composing representations needs no data plumbing.
 *
 * `ball` scales the van der Waals radius; `stick` is the world-space stick width.
 */
export const BallAndStick = ({ select = null, color, ball = 0.3, stick = 0.28, endpoints = 'both', ...props }) => {
  const shared = color !== undefined ? { color } : {};
  return [
    use(Spacefill, { select, scale: ball, ...shared, ...props }),
    use(Bonds, { select, width: stick, endpoints, ...shared, ...props }),
  ];
};
