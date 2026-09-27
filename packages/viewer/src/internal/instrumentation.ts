// Dev-only invalidation and GPU resource counters (hardening X2).
//
// NOT public API: nothing here is exported from the package's "." entry or its
// d.ts. Tests import this module by relative path. Every hook in production
// code is a call to `count`/`gauge`/`trackOwnedBuffer`, which return after one
// boolean check while instrumentation is disabled (the default), or
// `useBindingProbe` (./use-binding-probe.ts), which is a single useMemo whose callback runs only when a
// style dependency changes and then returns after the same boolean check.
//
// Counter vocabulary (the change->work table in
// docs/findings/2026-09-17-architecture-review.md):
// - topologyBuilds: topology-only derivations (activeAtoms view policy, bond
//   inference that actually ran rather than hit table's cache).
// - geometryBuilds: CPU geometry derivations (bond columns, traces, tube/ribbon
//   splines, surface field+mesh, point base sizes, annotation anchors).
// - gathers: per-row copies driven by a selection mapping (atom gathers,
//   attribute columns, bond endpoint attributes, surface atom gather).
// - allocations: GPU buffers created by viewer-owned sources.
// - uploadBytes: bytes handed to viewer-owned GPU sources for upload.
// - bindingUpdates: a representation forwarded changed style values (colour,
//   alpha, size, clock) to its layer bindings.
// - shaderBuilds: a representation generated a new WGSL module (a volume
//   slice's sampler, a field-line integrator), e.g. for a new grid.
// Each is also recorded per label as `detail["<counter>:<label>"]`.
// This module has no Live/GPU imports so pure kernels can call it under plain
// `deno test`; the Live hook lives in ./use-binding-probe.ts.

const NAMES = [
  "topologyBuilds",
  "geometryBuilds",
  "gathers",
  "allocations",
  "uploadBytes",
  "bindingUpdates",
  "shaderBuilds",
] as const;
/** One of the work counters (see the vocabulary above). */
export type CounterName = typeof NAMES[number];
type WriteKind = "storage" | "uniform" | "other";

/** A plain, JSON-serialisable copy of every counter. */
export type CounterSnapshot = Record<CounterName, number> & {
  readonly detail: Record<string, number>;
  readonly gauges: Record<string, number>;
  readonly ownedBuffers: {
    readonly created: number;
    readonly destroyed: number;
    readonly live: number;
    /** Live bytes per `trackOwnedBuffer` label. */
    readonly bytes: Record<string, number>;
  };
  readonly deviceBuffers: {
    readonly created: number;
    readonly destroyed: number;
    readonly live: number;
    readonly writeBytes: Record<WriteKind, number>;
  };
};

let enabled = false;
let totals: Record<CounterName, number>,
  detail: Record<string, number>,
  gauges: Record<string, number>;
// Live buffer accounting is never reset: live = created - destroyed since the
// counters were enabled, so a test can compare against its own baseline.
const owned = { created: 0, destroyed: 0 };
const device = {
  created: 0,
  destroyed: 0,
  writeBytes: { storage: 0, uniform: 0, other: 0 } as Record<WriteKind, number>,
};
let seenOwned = new WeakMap<GPUBuffer, string>();
let ownedBytes: Record<string, number> = {};
let onceKeys = new WeakMap<object, Set<string>>();

const clear = (): void => {
  totals = Object.fromEntries(NAMES.map((name) => [name, 0])) as Record<
    CounterName,
    number
  >;
  detail = {};
  gauges = {};
};
clear();

export const isInstrumented = (): boolean => enabled;
export const enableInstrumentation = (): void => {
  enabled = true;
};
export const disableInstrumentation = (): void => {
  enabled = false;
};
/** Zero the work counters and gauges (not the live-buffer accounting). */
export const resetCounters = (): void => {
  clear();
};

/** Add `n` to counter `name`, attributed to `label`. No-op while disabled. */
export function count(name: CounterName, label: string, n = 1): void {
  if (!enabled) return;
  totals[name] += n;
  const key = `${name}:${label}`;
  detail[key] = (detail[key] ?? 0) + n;
}

/**
 * Count once per (object, key): mirrors a cache the viewer cannot observe
 * directly (e.g. table's inferred-bond cache keyed on the StructureData and its
 * positions revision), so a cache hit is not reported as a build.
 */
export function countOnce(
  object: object,
  key: string,
  name: CounterName,
  label: string,
): void {
  if (!enabled) return;
  let keys = onceKeys.get(object);
  if (!keys) onceKeys.set(object, keys = new Set());
  if (keys.has(key)) return;
  keys.add(key);
  count(name, label);
}

/** Record the high-water mark of a size (e.g. a cache). No-op while disabled. */
export function gauge(name: string, value: number): void {
  if (!enabled) return;
  if (!(value <= gauges[name])) gauges[name] = value;
}

/**
 * Note a GPU buffer owned by viewer code. The first sighting counts one
 * allocation; `release` (returned) counts its destruction once.
 */
export function trackOwnedBuffer(buffer: GPUBuffer, label: string): void {
  if (!enabled || seenOwned.has(buffer)) return;
  seenOwned.set(buffer, label);
  owned.created += 1;
  ownedBytes[label] = (ownedBytes[label] ?? 0) + buffer.size;
  count("allocations", label);
}
export function releaseOwnedBuffer(buffer: GPUBuffer): void {
  const label = enabled ? seenOwned.get(buffer) : undefined;
  if (label === undefined) return;
  seenOwned.delete(buffer);
  owned.destroyed += 1;
  ownedBytes[label] -= buffer.size;
}

// Created-but-not-destroyed buffers, held weakly so a buffer the page dropped
// (and the browser garbage-collected) can be told apart from one still retained.
const liveDevice = new Map<WeakRef<GPUBuffer>, string>();
let collectedDevice = 0;
const refs = new WeakMap<GPUBuffer, WeakRef<GPUBuffer>>();
const originOf = ({ label = "", size, usage }: GPUBufferDescriptor): string => {
  const frames = (new Error().stack ?? "").split("\n").slice(1)
    .filter((line) => !line.includes("instrumentation."))
    .slice(0, 4).map((line) =>
      line.trim().replace(/^at /, "").replace(/\?[^:)]*/, "").replace(
        /^.*\/node_modules\//,
        "",
      )
    );
  return `${usage} ${size} ${label} @ ${frames.join(" < ")}`;
};

/**
 * Wrap one GPUDevice instance (dev/test only) so every buffer it creates and
 * destroys, and every queue.writeBuffer, is counted. This sees use.gpu's own
 * internal buffers too, which the viewer-owned counters above cannot.
 */
export function instrumentDevice(gpuDevice: GPUDevice): GPUDevice {
  if (
    (gpuDevice as GPUDevice & { __molgpuInstrumented?: boolean })
      .__molgpuInstrumented
  ) return gpuDevice;
  const create = gpuDevice.createBuffer;
  const destroyed = new WeakSet<GPUBuffer>();
  gpuDevice.createBuffer = function (
    this: GPUDevice,
    descriptor: GPUBufferDescriptor,
  ): GPUBuffer {
    const buffer = create.call(this, descriptor);
    if (!enabled) return buffer;
    device.created += 1;
    const ref = new WeakRef(buffer);
    liveDevice.set(ref, originOf(descriptor));
    refs.set(buffer, ref);
    const destroy = buffer.destroy;
    buffer.destroy = function (this: GPUBuffer): void {
      if (!destroyed.has(this)) {
        destroyed.add(this);
        device.destroyed += 1;
        liveDevice.delete(refs.get(this)!);
      }
      return destroy.call(this);
    };
    return buffer;
  };
  const queue = gpuDevice.queue;
  const write = queue.writeBuffer;
  queue.writeBuffer = function (
    this: GPUQueue,
    buffer: GPUBuffer,
    _offset: number,
    data: BufferSource,
    dataOffset = 0,
    size?: number,
  ): void {
    if (enabled) {
      const perElement =
        (data as ArrayBufferView & { BYTES_PER_ELEMENT?: number })
          .BYTES_PER_ELEMENT ?? 1;
      const bytes = size !== undefined
        ? size * perElement
        : (data.byteLength - dataOffset * perElement);
      const usage = buffer.usage ?? 0;
      const kind = usage & 0x80
        ? "storage"
        : usage & 0x40
        ? "uniform"
        : "other"; // GPUBufferUsage.STORAGE / UNIFORM
      device.writeBytes[kind] += bytes;
    }
    return write.apply(
      this,
      arguments as unknown as Parameters<GPUQueue["writeBuffer"]>,
    );
  };
  Object.defineProperty(gpuDevice, "__molgpuInstrumented", { value: true });
  return gpuDevice;
}

/** Live device buffers grouped by origin: `usage size label @ caller frames`,
 * where the frames are the first few non-instrumentation stack frames. Used to
 * attribute device-level leaks to the code that allocated them. `collected`
 * counts buffers the browser garbage-collected without a destroy() call. */
export function deviceBufferOrigins(): {
  retained: Record<string, number>;
  collected: number;
} {
  const retained: Record<string, number> = {};
  for (const [ref, origin] of liveDevice) {
    if (ref.deref()) retained[origin] = (retained[origin] ?? 0) + 1;
    else {
      liveDevice.delete(ref);
      collectedDevice += 1;
    }
  }
  return { retained, collected: collectedDevice };
}

/** A plain, JSON-serialisable copy of every counter. */
export function snapshotCounters(): CounterSnapshot {
  return {
    ...totals,
    detail: { ...detail },
    gauges: { ...gauges },
    ownedBuffers: {
      ...owned,
      live: owned.created - owned.destroyed,
      bytes: { ...ownedBytes },
    },
    deviceBuffers: {
      created: device.created,
      destroyed: device.destroyed,
      live: device.created - device.destroyed,
      writeBytes: { ...device.writeBytes },
    },
  };
}

/** Test-only: forget everything, including live-buffer accounting. */
export function resetAllInstrumentation(): void {
  clear();
  owned.created = owned.destroyed = 0;
  device.created = device.destroyed = 0;
  liveDevice.clear();
  collectedDevice = 0;
  device.writeBytes = { storage: 0, uniform: 0, other: 0 };
  seenOwned = new WeakMap();
  ownedBytes = {};
  onceKeys = new WeakMap();
}
