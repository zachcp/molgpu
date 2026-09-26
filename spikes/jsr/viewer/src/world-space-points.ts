import { use, useMemo, type LC } from '@use-gpu/live';
import { PointLayer, RawData, useViewContext, useShader, useShaderRef, type PointLayerProps } from '@use-gpu/workbench';
import type { StorageSource } from '@use-gpu/core';
import type { ShaderSource } from '@use-gpu/shader';
import { wgsl } from '@use-gpu/shader/wgsl';
import { pointSizesForRadii } from './internal/point-size.ts';
import { useRepaint } from './internal/use-repaint.ts';
import { count as countWork } from './internal/instrumentation.ts';
import { OwnedSource } from './internal/column-source.ts';

const SCALED_SIZE = wgsl`
@link fn getBase(index: u32) -> f32;
@link fn getScale() -> f32;
@export fn getSize(index: u32) -> f32 { return getBase(index) * getScale(); }
`;

const ScaledPoints: LC<{ baseSource: ShaderSource; scaleRef: ShaderSource } & Partial<PointLayerProps>> = ({ baseSource, scaleRef, ...props }) => {
  const sizes = useShader(SCALED_SIZE, [baseSource, scaleRef]);
  return use(PointLayer, { sizes, depth: 1, ...props });
};

export type WorldSpacePointLayerProps = {
  positions: ShaderSource; radii: Float32Array; count?: number; scale?: number;
} & Omit<Partial<PointLayerProps>, 'positions' | 'sizes' | 'count'>;

/** Atom radii in Ångström through PointLayer's camera-normalized `sizes`. */
export const WorldSpacePointLayer: LC<WorldSpacePointLayerProps> = ({ positions, radii, count = radii.length, scale = 1, ...props }) => {
  useRepaint();
  const { uniforms } = useViewContext();
  const pixelRatio = uniforms.viewPixelRatio.current as number;
  const scales = uniforms.viewWorldScale.current;
  const viewScale = scales[0], worldScale = scales[1];
  const worldUnitsPerSize = pixelRatio * viewScale * worldScale;
  const base = useMemo(() => {
    const sizes = pointSizesForRadii(radii, { pixelRatio: 1, viewScale: worldUnitsPerSize, worldScale: 1 }, 1);
    countWork('geometryBuilds', 'points:base-sizes');
    return sizes;
  }, [radii, worldUnitsPerSize]);
  const scaleRef = useShaderRef(scale);
  return use(RawData, { data: base, format: 'f32', render: (source: StorageSource) => use(OwnedSource, {
    source, label: 'base-sizes', counter: 'base-sizes',
    render: (baseSource: StorageSource) => use(ScaledPoints, { baseSource, scaleRef, positions, count, ...props }),
  }) });
};
