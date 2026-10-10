import type { LC } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import type { PointLayerProps } from "@use-gpu/workbench";
import { use } from "@use-gpu/live";
import {
  PointLayer,
  useShader,
  useShaderRef,
  useViewContext,
} from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { pointSizeForRadius } from "../rendering/point-size.ts";
import { useRepaint } from "../internal/use-repaint.ts";

// PointLayer accepts a shader source for sizes. Read the existing GPU radii and
// apply the Ångström-to-PointLayer conversion as one uniform, with no second
// per-atom size buffer or camera-dependent CPU pass.
const SCALED_SIZE = wgsl`
@link fn getRadius(index: u32) -> f32;
@link fn getFactor() -> f32;
@export fn getSize(index: u32) -> f32 { return getRadius(index) * getFactor(); }
`;

/**
 * Draw atom radii expressed in Ångström through PointLayer's camera-normalized
 * `sizes` API. Positions, radii and colours are caller-provided GPU sources;
 * camera and display scale changes update only the size factor uniform.
 */
export const WorldSpacePointLayer: LC<
  & {
    positions: ShaderSource;
    colors?: ShaderSource;
    radii: ShaderSource;
    count: number;
    scale?: number;
  }
  & Omit<PointLayerProps, "positions" | "colors" | "sizes" | "count" | "depth">
> = (
  { positions, colors, radii, count, scale = 1, ...props },
) => {
  useRepaint();
  const { uniforms } = useViewContext();
  const pixelRatio = uniforms.viewPixelRatio.current;
  const [viewScale, worldScale] = uniforms.viewWorldScale.current;
  const factor = pointSizeForRadius(scale, {
    pixelRatio,
    viewScale,
    worldScale,
  });
  const factorRef = useShaderRef(factor);
  const sizes = useShader(SCALED_SIZE, [radii, factorRef]);
  return use(PointLayer, {
    positions,
    colors,
    sizes,
    count,
    depth: 1,
    ...props,
  });
};
