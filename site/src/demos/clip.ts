import { provide, use } from "@use-gpu/live";
import {
  ScissorContext,
  useCombinedScissor,
  useShader,
  useShaderRefs,
} from "@use-gpu/workbench";
import { getScissorPlane } from "@use-gpu/wgsl/scissor/scissor-plane.wgsl";
import type { ViewerElement } from "@molgpu/viewer";

type Vec3 = readonly [number, number, number];

/** One world-space half-space n·p + offset >= 0, chained onto any parent scissor. */
const ClipPlane = (
  { normal, offset, children }: {
    normal: Vec3;
    offset: number;
    children?: ViewerElement;
  },
) => {
  const length = Math.hypot(...normal);
  const plane = [...normal.map((v) => v / length), offset / length];
  // channel -1: the plane writes the axis its normal leans on most.
  const bound = useShader(
    getScissorPlane,
    useShaderRefs<number | number[]>(plane, -1, 0),
  );
  return provide(ScissorContext, useCombinedScissor(bound), children);
};

/**
 * Keep world points with `from <= n·p <= to` (Å along `normal`); omit `to` for
 * a single cut. use.gpu's scissor plane (ScissorPlane in @use-gpu/plot, minus
 * the matrix handling the site does not need) discards per fragment in every
 * primitive and in the picking, depth and shadow passes. Moving the slab only
 * rewrites shader uniforms. Cuts are open: no caps are drawn.
 */
export const ClipSlab = (
  { normal, from, to, children }: {
    normal: Vec3;
    from: number;
    to?: number;
    children?: ViewerElement;
  },
) => {
  const near = (inner?: ViewerElement) =>
    use(ClipPlane, { normal, offset: -from, children: inner });
  if (to === undefined) return near(children);
  const back: Vec3 = [-normal[0], -normal[1], -normal[2]];
  return near(use(ClipPlane, { normal: back, offset: to, children }));
};
