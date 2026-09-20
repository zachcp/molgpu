// Built-in colour fields: a small, closed set composed from the field
// primitives. There is deliberately no user-facing expression language — these
// are the common presets (molgpu-sept-urn.3), and callers reach for the
// primitives (categorical/linear/colormap) directly for anything else.
import { attribute, categorical, linear, colormap } from './index.mjs';

// CPK-style element colours for the common biomolecular elements. Unlisted
// elements take the field's fallback.
const CPK = {
  1:  [0.92, 0.92, 0.94, 1], // H
  6:  [0.55, 0.57, 0.60, 1], // C
  7:  [0.35, 0.50, 0.92, 1], // N
  8:  [0.90, 0.36, 0.33, 1], // O
  15: [0.95, 0.55, 0.25, 1], // P
  16: [0.95, 0.80, 0.30, 1], // S
};

const COOL_WARM = [[0, [0.23, 0.30, 0.75, 1]], [0.5, [0.95, 0.95, 0.95, 1]], [1, [0.75, 0.20, 0.20, 1]]];
const RAINBOW = [
  [0, [0.80, 0.15, 0.15, 1]], [0.25, [0.90, 0.70, 0.15, 1]], [0.5, [0.15, 0.70, 0.25, 1]],
  [0.75, [0.15, 0.50, 0.90, 1]], [1, [0.55, 0.15, 0.70, 1]],
];
const CHAIN_CYCLE = [
  [0.30, 0.60, 0.90, 1], [0.90, 0.55, 0.30, 1], [0.40, 0.80, 0.45, 1], [0.85, 0.45, 0.80, 1],
  [0.90, 0.80, 0.35, 1], [0.40, 0.80, 0.80, 1], [0.85, 0.50, 0.50, 1], [0.60, 0.60, 0.90, 1],
];

/** Colour atoms by element (CPK), with `fallback` for uncommon elements. */
export const byElement = (fallback = [0.85, 0.45, 0.80, 1]) => categorical(attribute('element'), CPK, fallback);

/** Colour atoms by B-factor over `domain` (default [0,100]) on a cool→warm ramp.
 *  Auto-range with `columnRange(data, 'bfactor')`. */
export const byBfactor = ({ domain = [0, 100], stops = COOL_WARM } = {}) =>
  colormap(linear(attribute('bfactor'), { domain, overflow: 'clamp' }), stops);

/** Colour atoms by residue index over `domain` on a rainbow ramp. Pass
 *  `columnRange(data, 'residue')` (or [0, residueCount-1]) as `domain`. */
export const bySeq = ({ domain = [0, 1], stops = RAINBOW } = {}) =>
  colormap(linear(attribute('residue'), { domain, overflow: 'clamp' }), stops);

/** Colour atoms by chain from a cyclic palette. Chains beyond the palette take
 *  `fallback`. Pass a longer `palette` for more distinct chains. */
export const byChain = ({ palette = CHAIN_CYCLE, fallback = [0.6, 0.6, 0.6, 1] } = {}) =>
  categorical(attribute('atomChain'), Object.fromEntries(palette.map((c, i) => [i, c])), fallback);
