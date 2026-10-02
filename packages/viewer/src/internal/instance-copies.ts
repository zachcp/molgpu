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
  useMemo,
} from "@use-gpu/live";
import { wgsl } from "@use-gpu/shader/wgsl";
import { affineWgsl } from "@molgpu/dynamics/wgsl";
import { useCoordinates } from "../coordinates-context.ts";
import { useStructure } from "../structure-context.ts";
import { CoordinateKernel } from "./coordinate-kernel.ts";
import { viewer } from "./elements.ts";
import type { ViewerElement } from "../types.ts";
import { InstanceContext } from "./instance-context.ts";
import {
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
    if (!copies.length) return viewer(use(inner as LC<P>, props));
    return viewer(copies.map((copy) =>
      provide(
        InstanceContext,
        copy,
        use(CopyCoordinates, { copy, children: use(inner as LC<P>, props) }),
      )
    ));
  };
}
