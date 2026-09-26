import type { LC } from '@use-gpu/live';
import type { StorageSource } from '@use-gpu/core';
import type { ShaderSource } from '@use-gpu/shader';
import type { PointLayerProps } from '@use-gpu/workbench';
import { use, useMemo } from '@use-gpu/live';
import { PointLayer, RawData, useViewContext, useShader, useShaderRef } from '@use-gpu/workbench';
import { wgsl } from '@use-gpu/shader/wgsl';
import { pointSizesForRadii } from './internal/point-size.ts';
import { useRepaint } from './internal/use-repaint.ts';
import { count as countWork } from './internal/instrumentation.ts';
import { OwnedSource } from './internal/column-source.ts';

// Compose `scale` as a uniform over the per-atom base-size source instead of
// baking it into the size column. `getScale` binds to a shader ref, so changing
// scale (or an animated time driving it) is a uniform write — no new per-atom
// array, no re-upload. This is the derived-style-field shape from molgpu-sept-urn.5.
const SCALED_SIZE = wgsl`
@link fn getBase(index: u32) -> f32;
@link fn getScale() -> f32;
@export fn getSize(index: u32) -> f32 { return getBase(index) * getScale(); }
`;

// The size shader consumes a base column and the scale uniform; kept out of the
// RawData render callback so its hooks run in a stable component body.
const ScaledPoints: LC<{ baseSource: ShaderSource; scaleRef: ShaderSource } & Partial<PointLayerProps>> = ({ baseSource, scaleRef, ...props }) => {
  const sizes = useShader(SCALED_SIZE, [baseSource, scaleRef]);
  return use(PointLayer, { sizes, depth: 1, ...props });
};

/**
 * Draw atom radii expressed in Ångström through PointLayer's camera-normalized
 * `sizes` API. It owns only the derived size column; positions and colours
 * remain caller-provided GPU sources.
 *
 * The base size column excludes `scale` (and depends only on the radii and the
 * camera's combined world-units term), so a style-only `scale` change never
 * rebuilds or re-uploads it — the scale is applied shader-side from a uniform.
 */
export const WorldSpacePointLayer: LC<{
  positions: ShaderSource;
  colors?: ShaderSource;
  radii: Float32Array;
  /** Defaults to `radii.length`. */
  count?: number;
  scale?: number;
} & Omit<PointLayerProps, 'positions' | 'colors' | 'sizes' | 'count' | 'depth'>> = ({ positions, colors, radii, count = radii.length, scale = 1, ...props }) => {
  useRepaint();
  const { uniforms } = useViewContext();
  const pixelRatio = uniforms.viewPixelRatio.current;
  const [viewScale, worldScale] = uniforms.viewWorldScale.current;
  // OrbitCamera changes these two terms inversely while dollying. PointLayer
  // only consumes their product for depth:1, so depending on them separately
  // needlessly recreates and uploads the whole size column on every drag.
  const worldUnitsPerSize = pixelRatio * viewScale * worldScale;
  const base = useMemo(() => {
    const sizes = pointSizesForRadii(radii, { pixelRatio: 1, viewScale: worldUnitsPerSize, worldScale: 1 }, 1);
    countWork('geometryBuilds', 'points:base-sizes');
    countWork('uploadBytes', 'base-sizes', sizes.byteLength);
    return sizes;
  }, [radii, worldUnitsPerSize]);
  const scaleRef = useShaderRef(scale);

  // OwnedSource destroys the buffer on unmount and when RawData reallocates it.
  return use(RawData, { data: base, format: 'f32', render: (source: StorageSource) => use(OwnedSource, {
    source, label: 'base-sizes', counter: 'base-sizes',
    render: (baseSource: StorageSource) => use(ScaledPoints, { baseSource, scaleRef, positions, colors, count, ...props }),
  }) });
};
