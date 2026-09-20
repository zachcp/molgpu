/**
 * Convert an Ångström radius to PointLayer's `sizes` input for `depth: 1`.
 *
 * PointLayer treats `sizes` as a diameter. Its shaded quad vertex shader then
 * multiplies that diameter by `pixelRatio * viewScale * worldScale`. The
 * product is the amount of world space represented by one PointLayer unit.
 */
export function pointSizeForRadius(radius, { pixelRatio, viewScale, worldScale }) {
  for (const [name, value] of Object.entries({ radius, pixelRatio, viewScale, worldScale })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  return (2 * radius) / (pixelRatio * viewScale * worldScale);
}

/** The camera form of the same conversion, useful for tests and non-Live callers. */
export function pointSizeForCameraRadius(radius, { height, pixelRatio = 1, fov = Math.PI / 3, focus = 5 }) {
  for (const [name, value] of Object.entries({ radius, height, pixelRatio, fov, focus })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  return radius * height / (pixelRatio * Math.tan(fov / 2) * focus);
}

export function pointSizesForRadii(radii, view, scale = 1) {
  if (!(radii instanceof Float32Array)) throw new TypeError('radii must be a Float32Array');
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('scale must be a positive finite number');
  const sizes = new Float32Array(radii.length);
  for (let i = 0; i < radii.length; i++) sizes[i] = pointSizeForRadius(radii[i] * scale, view);
  return sizes;
}
