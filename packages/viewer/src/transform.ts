import { type LC, type LiveElement, use, useContext } from "@use-gpu/live";
import { wgsl } from "@use-gpu/shader/wgsl";
import {
  affineSelectedWgsl,
  affineWgsl,
  isIdentityAffine,
  validateAffine,
} from "@molgpu/dynamics/wgsl";
import type { Selection } from "@molgpu/select";
import { type Curve, sample } from "@molgpu/timeline";
import { useCoordinates } from "./coordinates-context.ts";
import { CoordinateKernel } from "./internal/coordinate-kernel.ts";
import { useComputeBuffers } from "./internal/compute-buffers.ts";

import { TimelineContext } from "./timeline-context.ts";
import type { TransformProps, ViewerComponent } from "./types.ts";
import { useSelectionInput } from "./internal/use-selection-input.ts";

const AFFINE = wgsl`${affineWgsl}`;
const SELECTED_AFFINE = wgsl`${affineSelectedWgsl}`;
const STORAGE = 0x0080;
const COPY_DST = 0x0008;

const columns = (matrix: readonly number[]): number[][] => [
  matrix.slice(0, 4),
  matrix.slice(4, 8),
  matrix.slice(8, 12),
  matrix.slice(12, 16),
];

const All: LC<{
  matrix: readonly number[];
  children: LiveElement;
}> = ({ matrix, children }) => {
  const upstream = useCoordinates();
  if (!upstream || !upstream.count || isIdentityAffine(matrix)) return children;
  return use(CoordinateKernel, {
    upstream,
    shader: AFFINE,
    args: columns(matrix),
    parameterKey: matrix.join(","),
    children,
  });
};

function bitset(selection: Selection, count: number): Uint32Array {
  const bits = new Uint32Array(Math.ceil(count / 32));
  for (const row of selection.indices) bits[row >>> 5] |= 1 << (row & 31);
  return bits;
}

const Selected: LC<{
  matrix: readonly number[];
  select: Selection;
  children: LiveElement;
}> = ({ matrix, select, children }) => {
  const upstream = useCoordinates();
  const selection = select;
  const identity = isIdentityAffine(matrix);
  const source = useComputeBuffers((buffers) => {
    if (identity || !upstream || !selection?.indices.length) return null;
    const bits = bitset(selection, upstream.count);
    return buffers.source(bits, STORAGE | COPY_DST, "coords:transform:mask");
  }, [identity, upstream?.count, selection?.id]);
  if (!upstream || !source) return children;
  return use(CoordinateKernel, {
    upstream,
    shader: SELECTED_AFFINE,
    args: columns(matrix),
    sources: [source],
    parameterKey: `${selection!.id}:${matrix.join(",")}`,
    children,
  });
};

/** Pure coordinate provider applying an affine to selected output atoms. */
export const Transform: ViewerComponent<TransformProps> = (
  { matrix, select, children, ...diagnostics },
) => {
  const resolved = useSelectionInput(
    select,
    "Transform",
    "select",
    diagnostics,
    { model: "all", altloc: "all" },
  );
  const time = useContext(TimelineContext);
  const curve = typeof (matrix as Curve<readonly number[]>).unit === "string";
  if (curve && time === null) {
    throw new Error(
      "<Transform> matrix curve needs a <TimelineProvider> ancestor",
    );
  }
  const value = curve
    ? sample(matrix as Curve<readonly number[]>, time!)
    : matrix as ArrayLike<number>;
  const entries = Array.from(value);
  validateAffine(entries);
  if (resolved.status !== "ready") return children;
  return (use(select ? Selected : All, {
    matrix: entries,
    ...(select ? { select: resolved.selection } : {}),
    children: children,
  }));
};
