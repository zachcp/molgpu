import type { StorageSource } from "@use-gpu/core";
import type { AttributeColumn } from "@molgpu/table";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./instrumentation.ts";

const STORAGE = 0x0080;
const COPY_DST = 0x0008;
const COPY_SRC = 0x0004;

/** One mounted Structure and immutable topology/attribute layout revision. */
export type ImmutableAttributeOwner = object;

// A style only borrows a column. The owner retains it across style and
// coordinate changes, then drops references on unmount or layout change.
interface Entry {
  readonly source: StorageSource;
  refs: number;
  eviction: ReturnType<typeof setTimeout> | null;
}
const owners = new WeakMap<
  ImmutableAttributeOwner,
  Map<GPUDevice, Map<AttributeColumn, Entry>>
>();
const devices = new WeakMap<GPUDevice, Map<AttributeColumn, Entry>>();
// Replacement can briefly unmount a Structure before its successor mounts.
// This is only a reuse window: no buffer is explicitly destroyed at expiry.
const REPLACEMENT_GRACE_MS = 100;

export function immutableAttributeSource(
  owner: ImmutableAttributeOwner,
  device: GPUDevice,
  column: AttributeColumn,
): StorageSource {
  let ownedDevices = owners.get(owner);
  if (!ownedDevices) owners.set(owner, ownedDevices = new Map());
  let ownedColumns = ownedDevices.get(device);
  if (!ownedColumns) ownedDevices.set(device, ownedColumns = new Map());
  const owned = ownedColumns.get(column);
  if (owned) return owned.source;

  let sharedColumns = devices.get(device);
  if (!sharedColumns) devices.set(device, sharedColumns = new Map());
  const shared = sharedColumns.get(column);
  if (shared) {
    if (shared.eviction !== null) {
      clearTimeout(shared.eviction);
      shared.eviction = null;
    }
    shared.refs++;
    ownedColumns.set(column, shared);
    return shared.source;
  }

  const values = Float32Array.from(column.values);
  const buffer = device.createBuffer({
    size: Math.max(4, values.byteLength),
    usage: STORAGE | COPY_DST | COPY_SRC,
    label: `molgpu:attribute:${column.name}`,
  });
  if (values.length) device.queue.writeBuffer(buffer, 0, values);
  trackOwnedBuffer(buffer, `attr:${column.name}`);
  count("uploadBytes", `attr:${column.name}`, values.byteLength);
  const source = Object.freeze({
    buffer,
    format: "f32",
    length: values.length,
    size: [values.length],
    version: 1,
  }) as StorageSource;
  const entry: Entry = { source, refs: 1, eviction: null };
  sharedColumns.set(column, entry);
  ownedColumns.set(column, entry);
  return source;
}

/** Drop the owner's references; pinned use.gpu draws may still hold a source. */
export function releaseImmutableAttributes(
  owner: ImmutableAttributeOwner,
): void {
  const ownedDevices = owners.get(owner);
  if (!ownedDevices) return;
  owners.delete(owner);
  for (const [device, columns] of ownedDevices) {
    for (const [column, entry] of columns) {
      if (--entry.refs > 0) continue;
      entry.eviction = setTimeout(() => {
        devices.get(device)?.delete(column);
        releaseOwnedBuffer(entry.source.buffer);
        entry.eviction = null;
      }, REPLACEMENT_GRACE_MS);
    }
  }
}
