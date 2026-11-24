// Shared mechanics of the raw WebGPU jobs (surface, SES field, DSSP, scans):
// buffer usage flags, a per-device compute-pipeline cache, bind groups of
// whole buffers, and a job-scoped set of transient buffers. Why these jobs stay
// raw is recorded in docs/findings/2026-10-02-native-compute-audit.md; this
// module only removes their duplicated boilerplate.

// GPUBufferUsage values, as literals so modules load where the global is absent.
export const MAP_READ = 0x0001;
export const COPY_SRC = 0x0004;
export const COPY_DST = 0x0008;
export const UNIFORM = 0x0040;
export const STORAGE = 0x0080;

const pipelines = new WeakMap<GPUDevice, Map<string, GPUComputePipeline>>();

/** A compute pipeline with an automatic layout, built once per device, code and entry point. */
export function computePipeline(
  device: GPUDevice,
  code: string,
  entryPoint: string,
  label: string,
): GPUComputePipeline {
  let cache = pipelines.get(device);
  if (!cache) pipelines.set(device, cache = new Map());
  const key = `${entryPoint}\n${code}`;
  let result = cache.get(key);
  if (!result) {
    result = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({ code, label }),
        entryPoint,
      },
      label,
    });
    cache.set(key, result);
  }
  return result;
}

/** A group-0 bind group binding whole buffers by binding index. */
export function bindBuffers(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  entries: readonly (readonly [number, GPUBuffer])[],
): GPUBindGroup {
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: entries.map(([binding, buffer]) => ({
      binding,
      resource: { buffer },
    })),
  });
}

/**
 * One job's transient buffers: each is at least 16 bytes, rounded to 4, labelled
 * `molgpu:<prefix>:<label>`, counted in `bytes`, and destroyed by `destroy()`
 * in the job's `finally`, unless detached to a caller that owns it.
 */
export class TransientBuffers {
  readonly #device: GPUDevice;
  readonly #prefix: string;
  readonly #made: GPUBuffer[] = [];
  /** Bytes allocated for owned buffers. */
  bytes = 0;
  /** Bytes copied back to the CPU by `read`. */
  readbackBytes = 0;

  constructor(device: GPUDevice, prefix: string) {
    this.#device = device;
    this.#prefix = prefix;
  }

  /** Allocate and optionally initialise a buffer; `owned: false` leaves it to the caller. */
  make = (
    size: number,
    usage: number,
    label: string,
    initial?: ArrayBufferView,
    owned = true,
  ): GPUBuffer => {
    const allocated = Math.max(16, Math.ceil(size / 4) * 4);
    const buffer = this.#device.createBuffer({
      size: allocated,
      usage,
      label: `molgpu:${this.#prefix}:${label}`,
    });
    if (owned) {
      this.#made.push(buffer);
      this.bytes += allocated;
    }
    if (initial?.byteLength) {
      this.#device.queue.writeBuffer(buffer, 0, initial as BufferSource);
    }
    return buffer;
  };

  /** Hand `buffers` to the caller: `destroy()` no longer touches them. */
  detach(...buffers: GPUBuffer[]): void {
    for (const buffer of buffers) {
      const i = this.#made.indexOf(buffer);
      if (i >= 0) this.#made.splice(i, 1);
    }
  }

  /** Copy `source[0, bytes)` to a transient staging buffer in its own submission and map it. */
  read = async (source: GPUBuffer, bytes: number): Promise<ArrayBuffer> => {
    this.readbackBytes += bytes;
    const staging = this.make(bytes, COPY_DST | MAP_READ, "readback");
    const encoder = this.#device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
    this.#device.queue.submit([encoder.finish()]);
    return await mapped(staging);
  };

  destroy(): void {
    for (const buffer of this.#made) buffer.destroy();
    this.#made.length = 0;
  }
}

/** Map a MAP_READ buffer and return a copy of its contents, unmapping it again. */
export async function mapped(buffer: GPUBuffer): Promise<ArrayBuffer> {
  await buffer.mapAsync(MAP_READ);
  try {
    return buffer.getMappedRange().slice(0);
  } finally {
    buffer.unmap();
  }
}
