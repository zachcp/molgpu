// <BallAndStick> — a COMPOSITE representation. It owns no drawing of its own;
// it is just <Spacefill> at a small radius plus <Bonds>, both scoped to the
// same selection.
//
// Worth noting as an ergonomics result: because representations pull their data
// from context and take a selection as a prop, composing them needs no plumbing
// at all. This is the whole payoff of the <Structure> intermediary.
import { use } from '@use-gpu/live';
import { Spacefill } from './spacefill.mjs';
import { Bonds } from './bonds.mjs';

export const BallAndStick = ({ select = null, ball = 0.22, stick = 0.22 }) => [
  use(Spacefill, { select, scale: ball }),
  use(Bonds, { select, width: stick }),
];
