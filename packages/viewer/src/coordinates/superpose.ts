// <Superpose>: a coordinate provider that rigidly fits live coordinates onto a
// reference. The fit runs on the GPU against the same upstream generation it
// moves: centroid, then centered covariance and a 3×3 proper-rotation solve,
// then apply (see superposeWgsl in @molgpu/dynamics). No frame is read back.
import {
  type LC,
  type LiveElement,
  use,
  useContext,
  useMemo,
} from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import { fitKabsch } from "@molgpu/dynamics";
import { SUPERPOSE_FIT_BYTES, superposeWgsl } from "@molgpu/dynamics/wgsl";
import type { StructureData, TrajectoryData } from "@molgpu/table";
import { useCoordinates } from "./coordinates-context.ts";
import { CoordinatePasses } from "./coordinate-passes.ts";
import { useComputeBuffers } from "../internal/compute-buffers.ts";

import { useStatusReadback } from "../internal/status-readback.ts";
import { useSourceRequest } from "../internal/source-request.ts";
import { useStatusDelivery } from "../internal/status-delivery.ts";
import { TrajectoryContext } from "../trajectory/trajectory-context.ts";
import type {
  SuperposeProps,
  SuperposeStatus,
  ViewerComponent,
} from "../types.ts";
import { useSelectionInput } from "../selection/use-selection-input.ts";
import type { Selection } from "@molgpu/select";
import type { SelectionDiagnostics } from "../types.ts";

const STORAGE = 0x0080;
const UNIFORM = 0x0040;
const COPY_DST = 0x0008;
const COPY_SRC = 0x0004;
const APPLY_GROUP = 64;

const pipelines = new WeakMap<GPUDevice, {
  centroid: GPUComputePipeline;
  covariance: GPUComputePipeline;
  apply: GPUComputePipeline;
}>();

function superposePipelines(device: GPUDevice) {
  let cached = pipelines.get(device);
  if (!cached) {
    const module = device.createShaderModule({
      code: superposeWgsl,
      label: "molgpu:superpose",
    });
    const make = (entryPoint: string) =>
      device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint },
        label: `molgpu:superpose:${entryPoint}`,
      });
    cached = {
      centroid: make("centroid"),
      covariance: make("covariance"),
      apply: make("apply"),
    };
    pipelines.set(device, cached);
  }
  return cached;
}

/** A reference position for every topology row; NaN where it has none. */
type Reference = { readonly positions: Float32Array; readonly id: number };
let nextReference = 0;
const referenceIds = new WeakMap<object, Reference>();

function referenceOf(
  key: object,
  positions: Float32Array,
): Reference {
  let reference = referenceIds.get(key);
  if (!reference) {
    reference = Object.freeze({ positions, id: ++nextReference });
    referenceIds.set(key, reference);
  }
  return reference;
}

/** Frame 0 of the nearest trajectory, scattered through its atomMap. */
async function firstFrame(
  trajectory: TrajectoryData,
  count: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const frame = await trajectory.source.read(0, signal);
  const positions = new Float32Array(count * 3).fill(NaN);
  const map = trajectory.atomMap;
  for (let i = 0; i < trajectory.atomCount; i++) {
    const row = map ? map[i] : i;
    positions.set(frame.positions.subarray(3 * i, 3 * i + 3), 3 * row);
  }
  return positions;
}

const Fitted: LC<{
  reference: Reference;
  rows: Uint32Array | null;
  rowsKey: string;
  translate: boolean;
  onStatus?: (status: SuperposeStatus) => void;
  children: LiveElement;
}> = ({ reference, rows, rowsKey, translate, onStatus, children }) => {
  const upstream = useCoordinates()!;
  const device = useDeviceContext();
  const fitCount = rows ? rows.length : upstream.count;
  // The reference is static: check its fit rows once, on the CPU, with the
  // same degeneracy rules as fitKabsch. A collinear live frame is handled on
  // the GPU by passing through.
  const gathered = useMemo(() => {
    const out = new Float32Array(fitCount * 3);
    for (let k = 0; k < fitCount; k++) {
      const row = rows ? rows[k] : k;
      for (let axis = 0; axis < 3; axis++) {
        const value = reference.positions[3 * row + axis];
        if (!Number.isFinite(value)) {
          throw new TypeError(
            `<Superpose> reference has no position for fit row ${row}`,
          );
        }
        out[3 * k + axis] = value;
      }
    }
    fitKabsch(out, out);
    return out;
  }, [reference.id, rowsKey, fitCount]);
  const buffers = useComputeBuffers((owned) => ({
    rows: owned.buffer(
      (rows?.length ?? 0) * 4,
      STORAGE | COPY_DST,
      "coords:superpose:rows",
      rows ?? undefined,
    ),
    reference: owned.buffer(
      gathered.byteLength,
      STORAGE | COPY_DST,
      "coords:superpose:reference",
      gathered,
    ),
    fit: owned.buffer(
      SUPERPOSE_FIT_BYTES,
      STORAGE | COPY_SRC,
      "coords:superpose:fit",
    ),
    params: owned.buffer(16, UNIFORM | COPY_DST, "coords:superpose:params"),
  }), [gathered, rows]);
  const statusReadback = useStatusReadback(
    SUPERPOSE_FIT_BYTES,
    "coords:superpose:staging",
    onStatus && ((data, generation) => {
      const values = new Float32Array(data);
      const solved = values[19] !== 0;
      onStatus(Object.freeze({
        status: solved ? "solved" : "passthrough",
        rmsd: solved ? values[23] : null,
        generation,
      }));
    }),
  );
  const encode = (
    encoder: GPUCommandEncoder,
    input: GPUBuffer,
    output: GPUBuffer,
    generation: number,
  ) => {
    const pipes = superposePipelines(device);
    device.queue.writeBuffer(
      buffers.params,
      0,
      Uint32Array.of(fitCount, rows ? 1 : 0, translate ? 1 : 0, upstream.count),
    );
    const group = (
      pipeline: GPUComputePipeline,
      entries: [number, GPUBuffer][],
    ) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: entries.map(([binding, buffer]) => ({
          binding,
          resource: { buffer },
        })),
      });
    const fitInputs: [number, GPUBuffer][] = [
      [0, input],
      [1, buffers.rows],
      [2, buffers.reference],
      [3, buffers.fit],
      [4, buffers.params],
    ];
    // Dispatches within a pass are ordered storage hazards: each stage sees
    // the previous stage's writes.
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipes.centroid);
    pass.setBindGroup(0, group(pipes.centroid, fitInputs));
    pass.dispatchWorkgroups(1);
    pass.setPipeline(pipes.covariance);
    pass.setBindGroup(0, group(pipes.covariance, fitInputs));
    pass.dispatchWorkgroups(1);
    pass.setPipeline(pipes.apply);
    pass.setBindGroup(
      0,
      group(pipes.apply, [
        [0, input],
        [3, buffers.fit],
        [4, buffers.params],
        [5, output],
      ]),
    );
    pass.dispatchWorkgroups(Math.ceil(upstream.count / APPLY_GROUP));
    pass.end();
    return statusReadback(encoder, buffers.fit, generation);
  };
  return use(CoordinatePasses, {
    upstream,
    label: "coords:superpose",
    parameterKey: `${reference.id}:${rowsKey}:${translate}`,
    encode,
    children,
  });
};

/** Trajectory already reports source errors; log only our own read failure. */
function logReferenceFailure(status: SuperposeStatus): void {
  if (status.status === "error" && status.phase === "reference") {
    console.error(
      "<Superpose>: the trajectory's first frame failed",
      status.error,
    );
  }
}

const Resolve: LC<{
  to: SuperposeProps["to"];
  rows: Uint32Array | null;
  rowsKey: string;
  translate: boolean;
  onStatus?: (status: SuperposeStatus) => void;
  children: LiveElement;
}> = ({ to, rows, rowsKey, translate, onStatus, children }) => {
  const upstream = useCoordinates()!;
  const context = useContext(TrajectoryContext);
  const scope = context?.owner === upstream.resource ? context : null;
  if (to === "first" && !scope) {
    throw new Error('<Superpose to="first"> needs a <Trajectory> ancestor');
  }
  const sourceError = to === "first" && scope?.status?.status === "error"
    ? scope.status.error
    : undefined;
  const sourceFailed = to === "first" && scope?.status?.status === "error";
  const trajectory = to === "first" && !sourceFailed
    ? scope!.state?.trajectory ?? null
    : null;
  const request = useSourceRequest(
    trajectory
      ? (signal) => firstFrame(trajectory, upstream.count, signal)
      : null,
    [trajectory, upstream.resource, upstream.count],
  );
  const first = request.state === "resolved" ? request.value : null;
  const status = useMemo<SuperposeStatus | null>(() => {
    if (to !== "first" || (!sourceFailed && first)) return null;
    return Object.freeze({
      status: sourceFailed || request.state === "rejected"
        ? "error"
        : "pending",
      rmsd: null,
      generation: upstream.generation,
      ...(sourceFailed
        ? { phase: "source" as const, error: sourceError }
        : request.state === "rejected"
        ? { phase: "reference" as const, error: request.error }
        : {}),
    });
  }, [
    to,
    scope?.owner,
    scope?.status,
    sourceFailed,
    sourceError,
    request,
    first,
  ]);
  useStatusDelivery(onStatus, status, logReferenceFailure);
  let reference: Reference | null;
  if (to === "first") {
    reference = first ? referenceOf(first, first) : null;
  } else {
    const positions = to instanceof Float32Array
      ? to
      : (to as StructureData).positions;
    if (positions.length !== upstream.count * 3) {
      throw new TypeError(
        `<Superpose> reference has ${
          positions.length / 3
        } atoms; the structure has ${upstream.count}`,
      );
    }
    reference = referenceOf(to, positions);
  }
  // Pass upstream through until the reference has loaded.
  if (!reference) return children;
  return use(Fitted, {
    reference,
    rows,
    rowsKey,
    translate,
    onStatus,
    children,
  });
};

const Select: LC<{
  to: SuperposeProps["to"];
  select: Selection;
  translate: boolean;
  onStatus?: (status: SuperposeStatus) => void;
  children: LiveElement;
}> = ({ to, select, translate, onStatus, children }) => {
  const selection = select;
  if (selection.indices.length < 3) return children;
  return use(Resolve, {
    to,
    rows: selection.indices,
    rowsKey: String(selection.id),
    translate,
    onStatus,
    children,
  });
};

const Provider: LC<
  SelectionDiagnostics & {
    to: SuperposeProps["to"];
    select: SuperposeProps["select"];
    translate: boolean;
    onStatus?: (status: SuperposeStatus) => void;
    children: LiveElement;
  }
> = ({ to, select, translate, onStatus, children, ...diagnostics }) => {
  const resolved = useSelectionInput(
    select,
    "Superpose",
    "select",
    diagnostics,
    { model: "all", altloc: "all" },
  );
  const upstream = useCoordinates();
  if (!upstream || !upstream.count || resolved.status !== "ready") {
    return children;
  }
  if (select) {
    return use(Select, {
      to,
      select: resolved.selection,
      translate,
      onStatus,
      children,
    });
  }
  if (upstream.count < 3) {
    throw new RangeError("<Superpose> needs at least three fit atoms");
  }
  return use(Resolve, {
    to,
    rows: null,
    rowsKey: "all",
    translate,
    onStatus,
    children,
  });
};

/**
 * Rigidly fit the nearest coordinates onto a reference (a coordinate
 * provider). `to` is a packed xyz array or a `StructureData` with
 * the same atoms, or `"first"` for frame 0 of the nearest `<Trajectory>`.
 * Unlike `<Transform select>`, `select` chooses the **fit** atoms; every output
 * atom moves by the fitted rotation (proper, no reflection) and, unless
 * `translate` is false, the translation onto the reference centroid. A live
 * frame whose fit atoms are collinear passes through; a collinear reference
 * throws.
 */
export const Superpose: ViewerComponent<SuperposeProps> = (
  { to, select, translate = true, onStatus, children, ...diagnostics },
) => {
  if (
    to !== "first" && !(to instanceof Float32Array) &&
    !(to && (to as StructureData).positions instanceof Float32Array)
  ) {
    throw new TypeError(
      '<Superpose> to must be "first", a Float32Array or StructureData',
    );
  }
  return (use(Provider, {
    ...diagnostics,
    to,
    select,
    translate,
    onStatus,
    children: children,
  }));
};
