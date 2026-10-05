/**
 * Test-only instrumentation for the typed consumer. It is a separate module so
 * consumer.tsx stays an ordinary application, and it records the two failure
 * channels a screenshot cannot show: uncaptured WebGPU errors and page errors.
 */
import type { StructureData } from "@molgpu/table";
import type { StorageSource } from "@use-gpu/core";
import {
  enableInstrumentation,
  snapshotCounters,
} from "../../src/internal/instrumentation.ts";

enableInstrumentation();

export type Mode =
  | "preloaded"
  | "empty"
  | "siblings"
  | "remote"
  | "missing"
  | "controlled"
  | "lifecycle"
  | "assembly"
  | "offset"
  | "bonds"
  | "attributes"
  | "attribute-revision"
  | "attribute-producer"
  | "attribute-roundtrip"
  | "snapshot"
  | "collision"
  | "replace";
export type Phase = "idle" | "loading" | "error" | "ready";
export interface State {
  mode: Mode;
  src: string;
  mounted: boolean;
  offsetX: number;
  attributeName: "ssCode" | "formalCharge" | "partialCharge" | "gpu:test";
  /** Lifecycle mode: the same Structure instance switches between src and data. */
  source: "src" | "data";
  /** Lifecycle mode: the Structure key, so a retry is a deliberate remount. */
  attempt: number;
  /** Collision mode: which of two hash-colliding row sets is selected. */
  collision: "left" | "right";
}
/** One in-flight load handed to the test rather than resolved by the fixture. */
export interface Pending {
  src: string;
  cancelled: () => boolean;
  settle: (data: StructureData | null) => void;
  fail: (error: unknown) => void;
}

export interface Probe {
  mounted: boolean;
  phase: Phase;
  /** Every phase change since the last reset; a final state hides transitions. */
  history: Phase[];
  failure: string | null;
  /** Atom count seen through useStructureResource() when the subtree was ready. */
  atoms: number | null;
  /** Which fixture dataset the ready subtree received. */
  dataset: "left" | "right" | "other" | null;
  missingCoordinatesError: string | null;
  rootPositionReads: { cpu: string; gpu: string } | null;
  coordinateSource: StorageSource | null;
  bondSource: StorageSource | null;
  /** useCoordinateSelection rows, keyed by where the probe is mounted. */
  coordinateSelection: Record<string, number[] | null>;
  /** Collision mode: rows a selected Transform moved, read from its snapshot. */
  transformed: number[] | null;
  coordinateSnapshot: {
    generation: number;
    revision: number;
    positions: number[];
  } | null;
  attributeSnapshot: {
    generation: number;
    values: number[];
    type: string;
  } | null;
  coordinateBounds: {
    min: readonly number[];
    max: readonly number[];
    centroid: readonly number[];
    count: number;
    generation: number;
  } | null;
  selectedBounds: Probe["coordinateBounds"];
  emptyBounds: Probe["coordinateBounds"];
  nonAtomBoundsError: string | null;
  coordinateFocus: { target: readonly number[]; radius: number } | null;
  device: GPUDevice | null;
  submissions: number;
  computePipelines: number;
  dispatches: number;
  counters: typeof snapshotCounters;
  errors: string[];
  pending: Pending[];
  update(patch: Partial<State>): void;
  reset(): void;
  snapshot(): {
    phase: Phase;
    history: Phase[];
    failure: string | null;
    atoms: number | null;
    dataset: Probe["dataset"];
    pending: number;
    errors: string[];
  };
  /**
   * Resolve (or, with "fail", reject) the nth outstanding load; reports
   * whether Live had cancelled it.
   */
  settle(index: number, which: "left" | "right" | "fail" | null): boolean;
  /** Reject the nth outstanding load with an arbitrary value; reports cancellation. */
  reject(index: number, reason: unknown): boolean;
  /** Runtime messages for the prop combinations the type system also rejects. */
  invalid(): string[];
}

export const probe: Probe = {
  mounted: false,
  phase: "idle",
  history: [],
  failure: null,
  atoms: null,
  dataset: null,
  missingCoordinatesError: null,
  rootPositionReads: null,
  coordinateSource: null,
  bondSource: null,
  coordinateSelection: {},
  transformed: null,
  coordinateSnapshot: null,
  attributeSnapshot: null,
  coordinateBounds: null,
  selectedBounds: null,
  emptyBounds: null,
  nonAtomBoundsError: null,
  coordinateFocus: null,
  device: null,
  submissions: 0,
  computePipelines: 0,
  dispatches: 0,
  counters: snapshotCounters,
  errors: [],
  pending: [],
  update: () => {},
  reset: () => {
    probe.history = [];
    probe.failure = null;
    probe.atoms = null;
    probe.dataset = null;
  },
  snapshot: () => ({
    phase: probe.phase,
    history: [...probe.history],
    failure: probe.failure,
    atoms: probe.atoms,
    dataset: probe.dataset,
    pending: probe.pending.length,
    errors: [...probe.errors],
  }),
  settle: () => false,
  reject: () => false,
  invalid: () => [],
};
(globalThis as unknown as { __viewer: Probe }).__viewer = probe;

const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (
  this: GPUAdapter,
  ...args: Parameters<typeof request>
) {
  const device = await request.apply(this, args);
  probe.device = device;
  const submit = device.queue.submit;
  device.queue.submit = function (...commands) {
    probe.submissions++;
    return submit.apply(this, commands);
  };
  const createComputePipelineAsync = device.createComputePipelineAsync;
  device.createComputePipelineAsync = function (...arguments_) {
    probe.computePipelines++;
    return createComputePipelineAsync.apply(this, arguments_);
  };
  const createCommandEncoder = device.createCommandEncoder;
  device.createCommandEncoder = function (...arguments_) {
    const encoder = createCommandEncoder.apply(this, arguments_);
    const beginComputePass = encoder.beginComputePass;
    encoder.beginComputePass = function (...passArguments) {
      const pass = beginComputePass.apply(this, passArguments);
      const dispatchWorkgroups = pass.dispatchWorkgroups;
      pass.dispatchWorkgroups = function (...size) {
        probe.dispatches++;
        return dispatchWorkgroups.apply(this, size);
      };
      return pass;
    };
    return encoder;
  };
  device.addEventListener("uncapturederror", (event) => {
    probe.errors.push((event as GPUUncapturedErrorEvent).error.message);
  });
  return device;
};
