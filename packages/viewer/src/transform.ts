import {
  type LC,
  type LiveElement,
  use,
  useContext,
  useMemo,
  useResource,
} from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import { useDeviceContext } from "@use-gpu/workbench";
import {
  affineSelectedWgsl,
  affineWgsl,
  isIdentityAffine,
  validateAffine,
} from "@molgpu/dynamics";
import type { Selection, SelectionQuery } from "@molgpu/select";
import { type Curve, sample } from "@molgpu/timeline";
import { useCoordinates } from "./coordinates-context.ts";
import { CoordinateKernel } from "./internal/coordinate-kernel.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import { live, viewer } from "./internal/elements.ts";
import { TimelineContext } from "./timeline-context.ts";
import type { TransformProps, ViewerComponent } from "./types.ts";
import { useCoordinateSelection } from "./use-coordinate-selection.ts";

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
  select: SelectionQuery;
  children: LiveElement;
}> = ({ matrix, select, children }) => {
  const upstream = useCoordinates();
  const selection = useCoordinateSelection(select);
  const device = useDeviceContext();
  if (selection && selection.domain !== "atom") {
    throw new TypeError("<Transform> select must be an atom query");
  }
  const identity = isIdentityAffine(matrix);
  const source = useMemo<StorageSource | null>(() => {
    if (identity || !upstream || !selection?.indices.length) return null;
    const bits = bitset(selection, upstream.count);
    const buffer = device.createBuffer({
      size: Math.max(4, bits.byteLength),
      usage: STORAGE | COPY_DST,
      label: "molgpu:coords:transform:mask",
    });
    device.queue.writeBuffer(buffer, 0, bits);
    trackOwnedBuffer(buffer, "coords:transform:mask");
    count("uploadBytes", "coords:transform:mask", bits.byteLength);
    return Object.freeze({
      buffer,
      format: "u32",
      length: bits.length,
      size: [bits.length],
      version: 1,
    }) as StorageSource;
  }, [device, identity, upstream?.count, selection?.id]);
  useResource((dispose) => {
    if (source) {
      dispose(() => {
        releaseOwnedBuffer(source.buffer);
        source.buffer.destroy();
      });
    }
  }, [source]);
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
  { matrix, select, children },
) => {
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
  return viewer(use(select ? Selected : All, {
    matrix: entries,
    ...(select ? { select } : {}),
    children: live(children),
  }));
};
