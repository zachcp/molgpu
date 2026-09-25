// Dev-only invalidation and GPU resource counters (hardening X2).
//
// NOT public API: nothing here is exported from the package's "." entry or its
// d.ts. Tests import this module by relative path. Every hook in production
// code is a call to `count`/`gauge`/`trackOwnedBuffer`, which return after one
// boolean check while instrumentation is disabled (the default), or
// `useBindingProbe` (./use-binding-probe.mjs), which is a single useMemo whose callback runs only when a
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
// Each is also recorded per label as `detail["<counter>:<label>"]`.
// This module has no Live/GPU imports so pure kernels can call it under plain
// `node --test`; the Live hook lives in ./use-binding-probe.mjs.

const NAMES = ['topologyBuilds', 'geometryBuilds', 'gathers', 'allocations', 'uploadBytes', 'bindingUpdates'];

let enabled = false;
let totals, detail, gauges;
// Live buffer accounting is never reset: live = created - destroyed since the
// counters were enabled, so a test can compare against its own baseline.
const owned = { created: 0, destroyed: 0 };
const device = { created: 0, destroyed: 0, writeBytes: { storage: 0, uniform: 0, other: 0 } };
let seenOwned = new WeakSet();
let onceKeys = new WeakMap();

const clear = () => {
  totals = Object.fromEntries(NAMES.map((name) => [name, 0]));
  detail = {};
  gauges = {};
};
clear();

export const isInstrumented = () => enabled;
export const enableInstrumentation = () => { enabled = true; };
export const disableInstrumentation = () => { enabled = false; };
/** Zero the work counters and gauges (not the live-buffer accounting). */
export const resetCounters = () => { clear(); };

/** Add `n` to counter `name`, attributed to `label`. No-op while disabled. */
export function count(name, label, n = 1) {
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
export function countOnce(object, key, name, label) {
  if (!enabled) return;
  let keys = onceKeys.get(object);
  if (!keys) onceKeys.set(object, keys = new Set());
  if (keys.has(key)) return;
  keys.add(key);
  count(name, label);
}

/** Record the high-water mark of a size (e.g. a cache). No-op while disabled. */
export function gauge(name, value) {
  if (!enabled) return;
  if (!(value <= gauges[name])) gauges[name] = value;
}

/**
 * Note a GPU buffer owned by viewer code. The first sighting counts one
 * allocation; `release` (returned) counts its destruction once.
 */
export function trackOwnedBuffer(buffer, label) {
  if (!enabled || seenOwned.has(buffer)) return;
  seenOwned.add(buffer);
  owned.created += 1;
  count('allocations', label);
}
export function releaseOwnedBuffer(buffer) {
  if (!enabled || !seenOwned.has(buffer)) return;
  seenOwned.delete(buffer);
  owned.destroyed += 1;
}

/**
 * Wrap one GPUDevice instance (dev/test only) so every buffer it creates and
 * destroys, and every queue.writeBuffer, is counted. This sees use.gpu's own
 * internal buffers too, which the viewer-owned counters above cannot.
 */
export function instrumentDevice(gpuDevice) {
  if (gpuDevice.__molgpuInstrumented) return gpuDevice;
  const create = gpuDevice.createBuffer;
  const destroyed = new WeakSet();
  gpuDevice.createBuffer = function (descriptor) {
    const buffer = create.call(this, descriptor);
    if (!enabled) return buffer;
    device.created += 1;
    const destroy = buffer.destroy;
    buffer.destroy = function () {
      if (!destroyed.has(this)) { destroyed.add(this); device.destroyed += 1; }
      return destroy.call(this);
    };
    return buffer;
  };
  const queue = gpuDevice.queue;
  const write = queue.writeBuffer;
  queue.writeBuffer = function (buffer, offset, data, dataOffset = 0, size) {
    if (enabled) {
      const bytes = size !== undefined ? size * (data.BYTES_PER_ELEMENT ?? 1) : (data.byteLength - dataOffset * (data.BYTES_PER_ELEMENT ?? 1));
      const usage = buffer.usage ?? 0;
      const kind = usage & 0x80 ? 'storage' : usage & 0x40 ? 'uniform' : 'other'; // GPUBufferUsage.STORAGE / UNIFORM
      device.writeBytes[kind] += bytes;
    }
    return write.apply(this, arguments);
  };
  Object.defineProperty(gpuDevice, '__molgpuInstrumented', { value: true });
  return gpuDevice;
}

/** A plain, JSON-serialisable copy of every counter. */
export function snapshotCounters() {
  return {
    ...totals,
    detail: { ...detail },
    gauges: { ...gauges },
    ownedBuffers: { ...owned, live: owned.created - owned.destroyed },
    deviceBuffers: { created: device.created, destroyed: device.destroyed, live: device.created - device.destroyed,
      writeBytes: { ...device.writeBytes } },
  };
}

/** Test-only: forget everything, including live-buffer accounting. */
export function resetAllInstrumentation() {
  clear();
  owned.created = owned.destroyed = 0;
  device.created = device.destroyed = 0;
  device.writeBytes = { storage: 0, uniform: 0, other: 0 };
  seenOwned = new WeakSet();
  onceKeys = new WeakMap();
}
