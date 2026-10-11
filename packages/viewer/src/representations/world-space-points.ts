import type { LC } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import type { PointLayerProps } from "@use-gpu/workbench";
import { provide, use, useCallback, useMemo } from "@use-gpu/live";
import {
  PointLayer,
  ShadowRender,
  useShader,
  useShaderRef,
  useVariantContext,
  VariantContext,
} from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { getWorldScale } from "@use-gpu/wgsl/use/view.wgsl";
import { useRepaint } from "../internal/use-repaint.ts";

// use.gpu 0.20.0 RawQuads supplies a solid depth vertex and a color fragment,
// selecting the flat masked shadow path even for ray-traced shaded spheres.
// Select its native shaded depth path only for this layer's shadow variant.
const SphereShadowRender: typeof ShadowRender = (props) => {
  const links = useMemo(() => ({
    ...props.links,
    getVertexDepth: props.links.getVertex,
    getFragment: undefined,
  }), [props.links]);
  return use(ShadowRender, { ...props, links });
};

// PointLayer accepts a shader source for sizes. Read the existing GPU radii and
// apply the Ångström-to-PointLayer conversion as one uniform, with no second
// per-atom size buffer or camera-dependent CPU pass.
const SCALED_SIZE = wgsl`
@link fn getRadius(index: u32) -> f32;
@link fn getFactor() -> f32;
@link fn getWorldScale(w: f32, depth: f32) -> f32;
@export fn getSize(index: u32) -> f32 { return 2.0 * getRadius(index) * getFactor() / getWorldScale(1.0, 1.0); }
`;

/**
 * Draw atom radii expressed in Ångström through PointLayer's camera-normalized
 * `sizes` API. Positions, radii and colours are caller-provided GPU sources;
 * display scale is a uniform and pass-local view uniforms determine sizing.
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
  const factorRef = useShaderRef(scale);
  const sizes = useShader(SCALED_SIZE, [radii, factorRef, getWorldScale]);
  const upstreamVariants = useVariantContext();
  const variants = useCallback(
    (draw: Parameters<typeof upstreamVariants>[0], hovered: boolean) => {
      const result = upstreamVariants(draw, hovered);
      return useMemo(() => {
        const adapt = (
          component: typeof ShadowRender | null | undefined,
        ) =>
          component === ShadowRender && draw.renderer === "shaded" &&
            draw.defines?.HAS_DEPTH
            ? SphereShadowRender
            : component;
        return Array.isArray(result) ? result.map(adapt) : adapt(result);
      }, [result, draw.renderer, draw.defines?.HAS_DEPTH]);
    },
    [upstreamVariants],
  );
  return provide(
    VariantContext,
    variants,
    use(PointLayer, {
      positions,
      colors,
      sizes,
      count,
      depth: 1,
      ...props,
    }),
  );
};
