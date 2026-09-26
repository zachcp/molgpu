export interface ViewScale { readonly pixelRatio: number; readonly viewScale: number; readonly worldScale: number }

/**
 * Convert an Ångström radius to PointLayer's `sizes` input for `depth: 1`.
 * PointLayer treats `sizes` as a diameter and multiplies it by
 * `pixelRatio * viewScale * worldScale`.
 */
export function pointSizeForRadius(radius: number, { pixelRatio, viewScale, worldScale }: ViewScale): number {
  for (const [name, value] of Object.entries({ radius, pixelRatio, viewScale, worldScale })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  return (2 * radius) / (pixelRatio * viewScale * worldScale);
}

export function pointSizesForRadii(radii: Float32Array, view: ViewScale, scale = 1): Float32Array {
  if (!(radii instanceof Float32Array)) throw new TypeError('radii must be a Float32Array');
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('scale must be a positive finite number');
  const sizes = new Float32Array(radii.length);
  for (let i = 0; i < radii.length; i++) sizes[i] = pointSizeForRadius(radii[i] * scale, view);
  return sizes;
}
