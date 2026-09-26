/** Camera scale terms PointLayer multiplies a `sizes` value by (`depth: 1`). */
export interface ViewScale { readonly pixelRatio: number; readonly viewScale: number; readonly worldScale: number }

/**
 * Convert an Ångström radius to PointLayer's `sizes` input for `depth: 1`.
 *
 * PointLayer treats `sizes` as a diameter. Its shaded quad vertex shader then
 * multiplies that diameter by `pixelRatio * viewScale * worldScale`. The
 * product is the amount of world space represented by one PointLayer unit.
 */
export function pointSizeForRadius(radius: number, view: ViewScale): number {
  const { pixelRatio, viewScale, worldScale } = view;
  for (const [name, value] of Object.entries({ radius, pixelRatio, viewScale, worldScale })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  return (2 * radius) / (pixelRatio * viewScale * worldScale);
}

/** The camera form of the same conversion, useful for tests and non-Live callers. */
export function pointSizeForCameraRadius(radius: number, camera: { readonly height: number; readonly pixelRatio?: number; readonly fov?: number; readonly focus?: number }): number {
  const { height, pixelRatio = 1, fov = Math.PI / 3, focus = 5 } = camera;
  for (const [name, value] of Object.entries({ radius, height, pixelRatio, fov, focus })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  return radius * height / (pixelRatio * Math.tan(fov / 2) * focus);
}

export function pointSizesForRadii(radii: Float32Array, view: ViewScale, scale = 1): Float32Array {
  if (!(radii instanceof Float32Array)) throw new TypeError('radii must be a Float32Array');
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('scale must be a positive finite number');
  const sizes = new Float32Array(radii.length);
  for (let i = 0; i < radii.length; i++) sizes[i] = pointSizeForRadius(radii[i] * scale, view);
  return sizes;
}
