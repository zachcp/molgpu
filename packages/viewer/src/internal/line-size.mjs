/** World-space radius emitted by shaded LineLayer for a scalar width/depth pair. */
export function lineRadiusForWidth(width, depth, { pixelRatio = 1, viewScale = 1, worldScale = 1, clipW = 1 } = {}) {
  for (const [name, value] of Object.entries({ width, pixelRatio, viewScale, worldScale, clipW })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  // Matches getWorldScale(): absolute for depth < 0; perspective-correct at 1.
  const scale = depth < 0 ? 1 : pixelRatio * viewScale * (depth === 0 ? clipW : worldScale);
  return width * scale / 2;
}
