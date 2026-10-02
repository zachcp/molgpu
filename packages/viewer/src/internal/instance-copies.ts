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
import type { ShaderSource } from "@use-gpu/shader";
import { useShader, useShaderRef } from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { affineWgsl } from "@molgpu/dynamics/wgsl";
import { useCoordinates } from "../coordinates-context.ts";
import { useStructure } from "../structure-context.ts";
import { CoordinateKernel } from "./coordinate-kernel.ts";

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

const TRANSFORM_POINTS = wgsl`
@link fn getPoint(i: u32) -> vec3<f32>;
@link fn getColumn0() -> vec4<f32>;
@link fn getColumn1() -> vec4<f32>;
@link fn getColumn2() -> vec4<f32>;
@link fn getColumn3() -> vec4<f32>;
@export fn getTransformedPoint(i: u32) -> vec3<f32> {
  let p = getPoint(i);
  return (getColumn0() * p.x + getColumn1() * p.y + getColumn2() * p.z +
    getColumn3()).xyz;
}
`;
const TRANSFORM_VECTORS = wgsl`
@link fn getVector(i: u32) -> vec3<f32>;
@link fn getColumn0() -> vec4<f32>;
@link fn getColumn1() -> vec4<f32>;
@link fn getColumn2() -> vec4<f32>;
@export fn getTransformedVector(i: u32) -> vec3<f32> {
  let v = getVector(i);
  return (getColumn0() * v.x + getColumn1() * v.y + getColumn2() * v.z).xyz;
}
`;

const CopyDraw: LC<{
  copy: InstanceCopy;
  positions: ShaderSource;
  normals: ShaderSource | null;
  render: (
    positions: ShaderSource,
    normals: ShaderSource | null,
  ) => LiveElement;
}> = ({ copy, positions, normals, render }) => {
  const [c0, c1, c2, c3] = columns(copy.matrix);
  const r0 = useShaderRef(c0),
    r1 = useShaderRef(c1),
    r2 = useShaderRef(c2),
    r3 = useShaderRef(c3);
  const moved = useShader(TRANSFORM_POINTS, [positions, r0, r1, r2, r3]);
  const turned = useShader(TRANSFORM_VECTORS, [
    normals ?? positions,
    r0,
    r1,
    r2,
  ]);
  return render(moved, normals ? turned : null);
};

/**
 * Draw a model-space geometry once per copy in DrawCopiesContext, its
 * positions (and normals, rotated) under that copy's operator; outside copies,
 * once as it is.
 */
export const CopyDraws: LC<{
  positions: ShaderSource;
  normals?: ShaderSource | null;
  render: (
    positions: ShaderSource,
    normals: ShaderSource | null,
  ) => LiveElement;
}> = ({ positions, normals = null, render }) => {
  const copies = useContext(DrawCopiesContext);
  if (!copies) return render(positions, normals);
  return copies.map((copy) =>
    isIdentity(copy.matrix)
      ? render(positions, normals)
      : use(CopyDraw, { copy, positions, normals, render })
  );
};
