// Biological assembly copies at draw time. A structure's
// `topology.instances` rows group by operator; each group draws its chains'
// rows once more under that operator, applied to the nearest live
// coordinates (after every coordinate provider), never by duplicating
// topology rows. Structures with no instances, or only identity rows covering
// each chain once (the asymmetric unit), draw exactly as before.
import {
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
} from "@use-gpu/live";
import {
  TransformContext,
  useCombinedMatrixTransform,
} from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { affineWgsl } from "@molgpu/dynamics/wgsl";
import { useCoordinates } from "../coordinates/coordinates-context.ts";
import { useStructure } from "../structure/structure-context.ts";
import { CoordinateKernel } from "../coordinates/coordinate-kernel.ts";

import type { ViewerElement } from "../types.ts";
import { DrawCopiesContext, InstanceContext } from "./instance-context.ts";
import {
  copyGroups,
  instanceCopies,
  type InstanceCopy,
  isIdentity,
} from "./instance-plan.ts";

const AFFINE = wgsl`${affineWgsl}`;

const columns = (m: Float32Array): number[][] => [
  Array.from(m.subarray(0, 4)),
  Array.from(m.subarray(4, 8)),
  Array.from(m.subarray(8, 12)),
  Array.from(m.subarray(12, 16)),
];

/** The nearest coordinates under one copy's operator (identity: unchanged). */
const CopyCoordinates: LC<{ copy: InstanceCopy; children: LiveElement }> = (
  { copy, children },
) => {
  const upstream = useCoordinates();
  if (!upstream || !upstream.count || isIdentity(copy.matrix)) return children;
  return use(CoordinateKernel, {
    upstream,
    shader: AFFINE,
    args: columns(copy.matrix),
    parameterKey: `instance:${copy.operatorId}:${copy.matrix.join(",")}`,
    children,
  });
};

/**
 * Wrap a representation so it draws once per assembly copy of the nearest
 * structure. With no copies it is the representation itself.
 */
export function withInstances<P>(
  inner: (props: P) => ViewerElement,
): (props: P) => ViewerElement {
  return (props: P) => {
    const nearest = useStructure();
    const copies = useMemo(
      () => instanceCopies(nearest.resource.data),
      [nearest.resource.data.topology],
    );
    if (!copies.length) return (use(inner as LC<P>, props));
    return (copies.map((copy) =>
      provide(
        InstanceContext,
        copy,
        use(CopyCoordinates, { copy, children: use(inner as LC<P>, props) }),
      )
    ));
  };
}

const IDENTITY = Float32Array.of(
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
);

/**
 * Wrap a CPU-geometry representation (Ribbon, Tube, Surface) so it builds its
 * geometry once per group of copies sharing the same chains, in model space,
 * and draws it under each copy's operator. With no copies it is the
 * representation itself.
 */
export function withGeometryCopies<P>(
  inner: (props: P) => ViewerElement,
): (props: P) => ViewerElement {
  return (props: P) => {
    const nearest = useStructure();
    const groups = useMemo(
      () => copyGroups(instanceCopies(nearest.resource.data)),
      [nearest.resource.data.topology],
    );
    if (!groups.length) return (use(inner as LC<P>, props));
    return (groups.map((group, index) =>
      provide(
        InstanceContext,
        Object.freeze({
          index,
          operatorId: group.copies[0].operatorId,
          matrix: IDENTITY,
          rows: group.rows,
        }),
        provide(DrawCopiesContext, group.copies, use(inner as LC<P>, props)),
      )
    ));
  };
}

/** Draw `children` under one copy's operator, chained onto any ambient transform. */
const CopyTransform: LC<{ copy: InstanceCopy; children: LiveElement }> = (
  { copy, children },
) => {
  const [context] = useCombinedMatrixTransform(copy.matrix);
  return provide(TransformContext, context, children);
};

/**
 * Draw a model-space geometry once per copy in DrawCopiesContext under that
 * copy's operator; outside copies, once as it is. The layer's own transform
 * applies the operator to positions, normals and bounds.
 */
export const CopyDraws: LC<{ children: ViewerElement }> = (props) => {
  const children = props.children as LiveElement;
  const copies = useContext(DrawCopiesContext);
  if (!copies) return children;
  return copies.map((copy) =>
    isIdentity(copy.matrix) ? children : use(CopyTransform, { copy, children })
  );
};
