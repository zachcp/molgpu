import { use, useMemo } from '@use-gpu/live';
import { PointLayer, RawData, useViewContext } from '@use-gpu/workbench';
import { pointSizesForRadii } from './internal/point-size.mjs';

/**
 * Draw atom radii expressed in Ångström through PointLayer's camera-normalized
 * `sizes` API. It deliberately owns only the derived size column; positions
 * and colours remain caller-provided GPU sources.
 */
export const WorldSpacePointLayer = ({ positions, colors, radii, count = radii.length, scale = 1, ...props }) => {
  const { uniforms } = useViewContext();
  const pixelRatio = uniforms.viewPixelRatio.current;
  const [viewScale, worldScale] = uniforms.viewWorldScale.current;
  // OrbitCamera changes these two terms inversely while dollying. PointLayer
  // only consumes their product for depth:1, so depending on them separately
  // needlessly recreates and uploads the whole size column on every drag.
  const worldUnitsPerSize = pixelRatio * viewScale * worldScale;
  const sizes = useMemo(
    () => pointSizesForRadii(radii, { pixelRatio: 1, viewScale: worldUnitsPerSize, worldScale: 1 }, scale),
    [radii, worldUnitsPerSize, scale],
  );

  return use(RawData, { data: sizes, format: 'f32', render: (sizeSource) =>
    use(PointLayer, { positions, colors, sizes: sizeSource, count, depth: 1, ...props })
  });
};
