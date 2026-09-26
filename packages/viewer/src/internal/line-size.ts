/** Camera scale terms that shaded LineLayer multiplies a width by. */
export interface LineScale { readonly pixelRatio?: number; readonly viewScale?: number; readonly worldScale?: number; readonly clipW?: number }

/** World-space radius emitted by shaded LineLayer for a scalar width/depth pair. */
export function lineRadiusForWidth(width: number, depth: number, view: LineScale = {}): number {
  const { pixelRatio = 1, viewScale = 1, worldScale = 1, clipW = 1 } = view;
  for (const [name, value] of Object.entries({ width, pixelRatio, viewScale, worldScale, clipW })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  // Matches getWorldScale(): absolute for depth < 0; perspective-correct at 1.
  const scale = depth < 0 ? 1 : pixelRatio * viewScale * (depth === 0 ? clipW : worldScale);
  return width * scale / 2;
}

/** Inverse of lineRadiusForWidth: the `width`/`widths` input that renders an Ångström radius. */
export function lineWidthForRadius(radius: number, depth: number, view: LineScale = {}): number {
  const { pixelRatio = 1, viewScale = 1, worldScale = 1, clipW = 1 } = view;
  for (const [name, value] of Object.entries({ radius, pixelRatio, viewScale, worldScale, clipW })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  }
  const scale = depth < 0 ? 1 : pixelRatio * viewScale * (depth === 0 ? clipW : worldScale);
  return 2 * radius / scale;
}
