// One GPU storage copy per VolumeData identity, shared by <Volume>,
// <Isosurface>, <VolumeSlice> and volumeSample field lowering. Refcounted per
// device; the last release destroys the buffer (plan finding 8).
import { useMemo, useResource } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import type { StorageSource } from "@use-gpu/core";
import type { VolumeData } from "@molgpu/table";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./instrumentation.ts";

const STORAGE = 0x0080;
const COPY_DST = 0x0008;
const COPY_SRC = 0x0004;

interface Entry {
  readonly source: StorageSource;
  refs: number;
}
const devices = new WeakMap<GPUDevice, Map<VolumeData, Entry>>();

function acquire(device: GPUDevice, volume: VolumeData): Entry {
  let entries = devices.get(device);
  if (!entries) devices.set(device, entries = new Map());
  let entry = entries.get(volume);
  if (!entry) {
    if (volume.components !== 1) {
      throw new TypeError(
        "GPU volumes must be scalar; extract one with volumeComponent",
      );
    }
    const { values } = volume;
    const buffer = device.createBuffer({
      size: Math.max(4, values.byteLength),
      // COPY_SRC lets tests and tools read the samples back.
      usage: STORAGE | COPY_DST | COPY_SRC,
      label: "molgpu:volume:values",
    });
    device.queue.writeBuffer(buffer, 0, values);
    trackOwnedBuffer(buffer, "volume:values");
    count("uploadBytes", "volume:values", values.byteLength);
    entry = {
      source: Object.freeze({
        buffer,
        format: "f32",
        length: values.length,
        size: [values.length],
        version: 1,
      }) as StorageSource,
      refs: 0,
    };
    entries.set(volume, entry);
  }
  entry.refs++;
  return entry;
}

function release(device: GPUDevice, volume: VolumeData): void {
  const entries = devices.get(device);
  const entry = entries?.get(volume);
  if (!entry || --entry.refs > 0) return;
  entries!.delete(volume);
  releaseOwnedBuffer(entry.source.buffer);
  entry.source.buffer.destroy();
}

/** The shared GPU samples of `volume`, held for this component's lifetime. */
export function useVolumeSource(volume: VolumeData): StorageSource;
export function useVolumeSource(
  volume: VolumeData | null,
): StorageSource | null;
export function useVolumeSource(
  volume: VolumeData | null,
): StorageSource | null {
  const device = useDeviceContext();
  // Acquire during render so the source exists on first draw; the resource
  // below owns the matching release.
  const entry = useMemo(
    () => volume ? acquire(device, volume) : null,
    [device, volume],
  );
  useResource((dispose) => {
    if (volume) dispose(() => release(device, volume));
  }, [device, volume]);
  return entry?.source ?? null;
}

/** Shared sources for every volume a compiled field reads, keyed by binding id. */
export function useVolumeSources(
  volumes: readonly { id: string; volume: VolumeData }[],
): Record<string, StorageSource> {
  const device = useDeviceContext();
  const key = volumes.map((v) => v.id).join();
  const entries = useMemo(
    () =>
      volumes.map(({ id, volume }) => [id, acquire(device, volume)] as const),
    [device, key],
  );
  useResource((dispose) => {
    dispose(() => {
      for (const { volume } of volumes) release(device, volume);
    });
  }, [device, key]);
  return useMemo(
    () => Object.fromEntries(entries.map(([id, e]) => [id, e.source])),
    [entries],
  );
}
