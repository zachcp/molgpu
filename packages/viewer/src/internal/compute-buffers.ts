// Allocations owned by one coordinate provider and bound only by that
// provider's own compute dispatches. Destroying them when the owner retires is
// covered by the owner-retirement acceptance matrix
// (docs/findings/2026-10-01-gpu-retirement-acceptance.md: replacement, resize,
// held compilation, hide and unmount). Never allocate here anything a draw can
// bind: such allocations release ownership without destroy, as in
// column-source.ts (docs/findings/2026-09-29-gpu-retirement-decision.md).
import { useMemo, useResource } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import { useDeviceContext } from "@use-gpu/workbench";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./instrumentation.ts";

/** One owner's compute-only buffers, destroyed together. */
export class ComputeBuffers {
  readonly #device: GPUDevice;
  readonly #made: GPUBuffer[] = [];

  constructor(device: GPUDevice) {
    this.#device = device;
  }

  /**
   * Allocate `max(minimum, size rounded up to 4)` bytes and upload `data` when
   * it is nonempty. The GPU label is `molgpu:<label>`; `label` alone keys the
   * ownership and upload counters.
   */
  buffer(
    size: number,
    usage: number,
    label: string,
    data?: ArrayBufferView,
    minimum = 16,
  ): GPUBuffer {
    const buffer = this.#device.createBuffer({
      size: Math.max(minimum, Math.ceil(size / 4) * 4),
      usage,
      label: `molgpu:${label}`,
    });
    trackOwnedBuffer(buffer, label);
    this.#made.push(buffer);
    if (data?.byteLength) {
      this.#device.queue.writeBuffer(buffer, 0, data as BufferSource);
      count("uploadBytes", label, data.byteLength);
    }
    return buffer;
  }

  /** A packed one-dimensional storage source holding `data`. */
  source(
    data: Uint32Array | Float32Array,
    usage: number,
    label: string,
    version = 1,
  ): StorageSource {
    return Object.freeze({
      buffer: this.buffer(data.byteLength, usage, label, data, 4),
      format: data instanceof Uint32Array ? "u32" : "f32",
      length: data.length,
      size: [data.length],
      version,
    }) as StorageSource;
  }

  destroy(): void {
    for (const buffer of this.#made) {
      releaseOwnedBuffer(buffer);
      buffer.destroy();
    }
    this.#made.length = 0;
  }
}

/** Build compute buffers when `dependencies` change; the previous set is
 * destroyed on replacement and the last on unmount. */
export function useComputeBuffers<T>(
  build: (buffers: ComputeBuffers) => T,
  dependencies: unknown[],
): T {
  const device = useDeviceContext();
  const built = useMemo(() => {
    const owner = new ComputeBuffers(device);
    return { owner, value: build(owner) };
  }, [device, ...dependencies]);
  useResource((dispose) => {
    dispose(() => built.owner.destroy());
  }, [built]);
  return built.value;
}
