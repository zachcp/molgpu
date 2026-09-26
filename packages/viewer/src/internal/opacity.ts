// The representations' shared `opacity` rule, kept free of use.gpu imports so
// it is unit-testable under Node (see use-opacity-colors.ts for the shader side).
//
import type { DrawMode, VectorLike } from '../types.ts';

// Effective alpha = colour alpha × opacity. Anything below 1 draws in the
// layer's 'transparent' mode — sorted after opaques and, under <Pass oit>,
// composited order-independently — instead of the default opaque mode, which
// writes depth and hides whatever is behind it. An explicit `mode` wins.

/** Validate an opacity prop: a finite number in [0, 1]. */
export const checkOpacity = (opacity: unknown, where: string): number => {
  if (typeof opacity !== 'number' || !(opacity >= 0 && opacity <= 1)) {
    throw new RangeError(`${where} opacity must be a number in [0, 1], got ${opacity}`);
  }
  return opacity as number;
};

/** A flat colour with its alpha scaled by `opacity` (returned as-is when opacity is 1). */
export const applyOpacity = <C extends VectorLike>(color: C, opacity: number): C | number[] => opacity === 1 ? color
  : [color[0], color[1], color[2], (color.length > 3 ? color[3] : 1) * opacity];

/** The alpha a flat colour will draw with, or 1 for a field (whose per-row alpha is unknown here). */
export const flatAlpha = (color: unknown, isField: boolean): number =>
  isField || (color as VectorLike).length < 4 ? 1 : (color as VectorLike)[3];

/**
 * Layer props for the draw mode: `{ mode }` when one applies, else `{}` so the
 * layer keeps its own default. `mode` is the caller's explicit prop, if any.
 */
export const modeProps = (mode: DrawMode | undefined, alpha: number): { mode?: DrawMode } =>
  mode !== undefined ? { mode } : alpha < 1 ? { mode: 'transparent' } : {};
