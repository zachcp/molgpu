import type { LC } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import type { PointLayerProps } from "@use-gpu/workbench";
import { use } from "@use-gpu/live";
import { PointLayer, useShader, useShaderRef } from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";

// PointLayer accepts a shader source for sizes. Read the existing GPU radii and
// convert radii to diameters in world units, with no camera-dependent conversion
// or second per-atom size buffer. Native depth: -1 applies in every render pass.
const SCALED_SIZE = wgsl`
@link fn getRadius(index: u32) -> f32;
@link fn getFactor() -> f32;
@export fn getSize(index: u32) -> f32 { return getRadius(index) * getFactor(); }
`;

/**
 * Draw atom radii expressed in Ångström through PointLayer's world-unit sizing.
 * Positions, radii and colours are caller-provided GPU sources; display scale
 * changes update only the diameter factor uniform.
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
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("scale must be a positive finite number");
  }
  const factorRef = useShaderRef(2 * scale);
  const sizes = useShader(SCALED_SIZE, [radii, factorRef]);
  return use(PointLayer, {
    positions,
    colors,
    sizes,
    count,
    depth: -1,
    ...props,
  });
};
