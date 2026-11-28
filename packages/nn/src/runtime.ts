// Raw WebGPU dispatch of the ops on a caller-supplied GPUDevice. Raw rather than
// a framework so weights and activations live in plain GPUBuffers this runtime
// owns (or the caller owns, through `wrap`), which a renderer on the same device
// can bind directly. Ops record into one command encoder; `flush` submits it.
import { CONCAT_WGSL, concatPlan } from "./ops/concat.ts";
import { MIX_WGSL, mixShape } from "./ops/mix.ts";
import { GATHER_ROWS_WGSL, gatherRowsShape } from "./ops/gather.ts";
import { PARAM_SLOTS, WORKGROUP } from "./ops/common.ts";
import {
  LAYER_NORM_EPS,
  LAYER_NORM_WGSL,
  layerNormShape,
} from "./ops/layer-norm.ts";
import { type Activation, LINEAR_WGSL, linearShape } from "./ops/linear.ts";
import { LOG_SOFTMAX_WGSL } from "./ops/log-softmax.ts";
import { NEIGHBOR_SUM_WGSL, neighborSumShape } from "./ops/neighbor-sum.ts";
import { TILE_MEAN_ABS_WGSL, tileMeanAbsShape } from "./ops/tile-mean-abs.ts";
import {
  elementCount,
  type IndexTensor,
  lastAxis,
  type Tensor,
} from "./tensor.ts";

// GPUBufferUsage values, as literals so the module loads where the global is absent.
const MAP_READ = 0x0001;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const STORAGE = 0x0080;
const TENSOR_USAGE = STORAGE | COPY_SRC | COPY_DST;
const MAX_GROUPS = 65535;

/** A tensor in a GPUBuffer: f32 values or u32 row indices, row-major from offset 0. */
export interface GpuTensor {
  readonly buffer: GPUBuffer;
  readonly shape: readonly number[];
  readonly dtype: "f32" | "u32";
  /** True when the runtime destroys the buffer on `release` or `destroy`. */
  readonly owned: boolean;
}

/** Runs the nn ops on one GPUDevice; owns every tensor it creates. */
export class NnRuntime {
  readonly device: GPUDevice;
  readonly #owned = new Set<GPUBuffer>();
  readonly #pipelines = new Map<string, GPUComputePipeline>();
  readonly #pendingUniforms: GPUBuffer[] = [];
  readonly #placeholder: GPUBuffer;
  #encoder: GPUCommandEncoder | null = null;
  #destroyed = false;

  constructor(device: GPUDevice) {
    this.device = device;
    // Bound where an optional input (bias, residual, mask) is absent.
    this.#placeholder = device.createBuffer({
      size: 16,
      usage: STORAGE,
      label: "molgpu:nn:placeholder",
    });
  }

  /** Upload a CPU tensor into a new owned buffer. */
  upload(t: Tensor, label = "tensor"): GpuTensor {
    return this.#create(t.shape, "f32", label, t.data);
  }

  /** A new owned f32 tensor of zeros (WebGPU zero-initializes buffers). */
  zeros(shape: readonly number[], label = "zeros"): GpuTensor {
    return this.#create(shape, "f32", label);
  }

  /** Upload row indices into a new owned buffer. */
  uploadIndex(t: IndexTensor, label = "index"): GpuTensor {
    return this.#create(t.shape, "u32", label, t.data);
  }

  /** Upload every named tensor, labelling each buffer with its name. */
  uploadWeights(weights: ReadonlyMap<string, Tensor>): Map<string, GpuTensor> {
    return new Map(
      [...weights].map(([name, t]) => [name, this.upload(t, name)]),
    );
  }

  /** View a caller-owned buffer as a tensor; the runtime never destroys it. */
  wrap(
    buffer: GPUBuffer,
    shape: readonly number[],
    dtype: "f32" | "u32" = "f32",
  ): GpuTensor {
    const bytes = 4 * elementCount(shape);
    if (buffer.size < bytes) {
      throw new Error(
        `wrap: buffer has ${buffer.size} bytes, shape needs ${bytes}`,
      );
    }
    if ((buffer.usage & STORAGE) === 0) {
      throw new Error("wrap: buffer needs STORAGE usage");
    }
    return { buffer, shape: [...shape], dtype, owned: false };
  }

  /** x Wᵀ + b with W in [out, in] layout and an optional fused GELU. */
  linear(
    x: GpuTensor,
    w: GpuTensor,
    b?: GpuTensor,
    activation: Activation = "none",
  ): GpuTensor {
    floats(x, w, b);
    const shape = linearShape(x.shape, w.shape, b?.shape);
    const [m, k] = lastAxis(x.shape, "linear");
    const n = w.shape[0];
    const y = this.#create(shape, "f32", "linear");
    this.#dispatch(
      "linear",
      LINEAR_WGSL,
      [m, n, k, (b ? 1 : 0) | (activation === "gelu" ? 2 : 0)],
      [x.buffer, w.buffer, b?.buffer ?? this.#placeholder, y.buffer],
      m * n,
    );
    return y;
  }

  /** LayerNorm over the last axis of x, or of x + residual. */
  layerNorm(
    x: GpuTensor,
    gamma: GpuTensor,
    beta: GpuTensor,
    options: { residual?: GpuTensor; eps?: number } = {},
  ): GpuTensor {
    const { residual, eps = LAYER_NORM_EPS } = options;
    floats(x, gamma, beta, residual);
    const [m, c] = layerNormShape(
      x.shape,
      gamma.shape,
      beta.shape,
      residual?.shape,
    );
    const y = this.#create(x.shape, "f32", "layer-norm");
    this.#dispatch(
      "layerNorm",
      LAYER_NORM_WGSL,
      [m, c, residual ? 1 : 0, f32Bits(eps)],
      [
        x.buffer,
        residual?.buffer ?? this.#placeholder,
        gamma.buffer,
        beta.buffer,
        y.buffer,
      ],
      m,
    );
    return y;
  }

  /** Rows of x [R, C] at each index; indices must be below R (not checked on the GPU). */
  gatherRows(x: GpuTensor, index: GpuTensor): GpuTensor {
    floats(x);
    if (index.dtype !== "u32") throw new Error("gatherRows: index must be u32");
    const shape = gatherRowsShape(x.shape, index.shape);
    const count = elementCount(index.shape);
    const y = this.#create(shape, "f32", "gather-rows");
    this.#dispatch(
      "gatherRows",
      GATHER_ROWS_WGSL,
      [count, x.shape[1]],
      [x.buffer, index.buffer, y.buffer],
      count * x.shape[1],
    );
    return y;
  }

  /** Sum of x [L, K, C] over K, weighted by mask [L, K], divided by scale. */
  neighborSum(
    x: GpuTensor,
    options: { mask?: GpuTensor; scale?: number } = {},
  ): GpuTensor {
    const { mask, scale = 1 } = options;
    floats(x, mask);
    const shape = neighborSumShape(x.shape, mask?.shape);
    const [l, k, c] = x.shape;
    const y = this.#create(shape, "f32", "neighbor-sum");
    this.#dispatch(
      "neighborSum",
      NEIGHBOR_SUM_WGSL,
      [l, k, c, mask ? 1 : 0, f32Bits(scale)],
      [x.buffer, mask?.buffer ?? this.#placeholder, y.buffer],
      l * c,
    );
    return y;
  }

  /** Log-softmax over the last axis. */
  logSoftmax(x: GpuTensor): GpuTensor {
    floats(x);
    const [m, c] = lastAxis(x.shape, "logSoftmax");
    const y = this.#create(x.shape, "f32", "log-softmax");
    this.#dispatch(
      "logSoftmax",
      LOG_SOFTMAX_WGSL,
      [m, c],
      [x.buffer, y.buffer],
      m,
    );
    return y;
  }

  /** Concatenate along the last axis; one side's leading dims must prefix the other's. */
  concat(a: GpuTensor, b: GpuTensor): GpuTensor {
    floats(a, b);
    const { shape, rows, repeat } = concatPlan(a.shape, b.shape);
    const ca = a.shape[a.shape.length - 1], cb = b.shape[b.shape.length - 1];
    const y = this.#create(shape, "f32", "concat");
    this.#dispatch(
      "concat",
      CONCAT_WGSL,
      [rows, ca, cb, repeat[0], repeat[1]],
      [a.buffer, b.buffer, y.buffer],
      rows * (ca + cb),
    );
    return y;
  }

  /** mask * a + (1 - mask) * b, with one mask value per row of a. */
  mix(a: GpuTensor, b: GpuTensor, mask: GpuTensor): GpuTensor {
    floats(a, b, mask);
    const [rows, c] = mixShape(a.shape, b.shape, mask.shape);
    const y = this.#create(a.shape, "f32", "mix");
    this.#dispatch(
      "mix",
      MIX_WGSL,
      [rows, c],
      [a.buffer, b.buffer, mask.buffer, y.buffer],
      rows * c,
    );
    return y;
  }

  /**
   * Snapshot mean |x| per 32 x 32 tile of a non-empty matrix, including partial
   * edges. Uses aligned input windows: x may exceed the storage binding limit,
   * but each 32-row band and the output grid must fit. x is not modified.
   */
  tileMeanAbs(x: GpuTensor): GpuTensor {
    floats(x);
    const shape = tileMeanAbsShape(x.shape);
    const [rows, cols] = x.shape;
    const limit = this.device.limits.maxStorageBufferBindingSize;
    const align = this.device.limits.minStorageBufferOffsetAlignment;
    if (4 * elementCount(shape) > limit) {
      throw new Error(
        "tileMeanAbs: output grid exceeds the storage binding limit",
      );
    }
    // Validate all windows before allocating or recording any work.
    for (let row = 0; row < rows; row += 32) {
      const start = row * cols * 4;
      const padding = start % align;
      if (padding + Math.min(32, rows - row) * cols * 4 > limit) {
        throw new Error(
          "tileMeanAbs: a 32-row band exceeds the storage binding limit",
        );
      }
    }
    const y = this.#create(shape, "f32", "tile-mean-abs");
    for (let row = 0; row < rows; row += 32) {
      const start = row * cols * 4;
      const offset = Math.floor(start / align) * align;
      const padding = start - offset;
      this.#dispatch(
        "tileMeanAbs",
        TILE_MEAN_ABS_WGSL,
        [rows, cols, row, padding / 4, shape[1]],
        [{
          buffer: x.buffer,
          offset,
          size: padding + Math.min(32, rows - row) * cols * 4,
        }, y.buffer],
        shape[1],
      );
    }
    return y;
  }

  /** A new owned tensor holding x's current values, recorded in dispatch order. */
  copy(x: GpuTensor, label = "copy"): GpuTensor {
    const y = this.#create(x.shape, x.dtype, label);
    const bytes = 4 * elementCount(x.shape);
    if (bytes) {
      this.#encoder ??= this.device.createCommandEncoder();
      this.#encoder.copyBufferToBuffer(x.buffer, 0, y.buffer, 0, bytes);
    }
    return y;
  }

  /** Submit the recorded dispatches. */
  flush(): void {
    this.#live();
    if (this.#encoder) {
      this.device.queue.submit([this.#encoder.finish()]);
      this.#encoder = null;
    }
    // Destroying after submit leaves the submitted work valid.
    for (const uniform of this.#pendingUniforms.splice(0)) uniform.destroy();
  }

  /** Flush, then copy a tensor back to the CPU. */
  async read(t: GpuTensor): Promise<Float32Array | Uint32Array> {
    this.#live();
    const bytes = 4 * elementCount(t.shape);
    const staging = this.device.createBuffer({
      size: Math.max(4, bytes),
      usage: MAP_READ | COPY_DST,
      label: "molgpu:nn:readback",
    });
    try {
      const encoder = this.#encoder ?? this.device.createCommandEncoder();
      this.#encoder = encoder;
      if (bytes) encoder.copyBufferToBuffer(t.buffer, 0, staging, 0, bytes);
      this.flush();
      await staging.mapAsync(MAP_READ);
      const copy = staging.getMappedRange().slice(0, bytes);
      staging.unmap();
      return t.dtype === "u32" ? new Uint32Array(copy) : new Float32Array(copy);
    } finally {
      staging.destroy();
    }
  }

  /** Destroy owned tensors' buffers after flushing work that may read them. */
  release(...tensors: GpuTensor[]): void {
    const owned = tensors.filter((t) => t.owned && this.#owned.has(t.buffer));
    if (!owned.length) return;
    this.flush();
    for (const t of owned) {
      if (this.#owned.delete(t.buffer)) t.buffer.destroy();
    }
  }

  /** Flush and destroy every owned buffer; wrapped buffers are left alone. */
  destroy(): void {
    if (this.#destroyed) return;
    this.flush();
    for (const buffer of this.#owned) buffer.destroy();
    this.#owned.clear();
    this.#placeholder.destroy();
    this.#destroyed = true;
  }

  #live(): void {
    if (this.#destroyed) throw new Error("NnRuntime used after destroy()");
  }

  #create(
    shape: readonly number[],
    dtype: "f32" | "u32",
    label: string,
    data?: Float32Array | Uint32Array,
  ): GpuTensor {
    this.#live();
    const bytes = 4 * elementCount(shape);
    const buffer = this.device.createBuffer({
      // Storage bindings need a non-zero, 4-byte multiple size.
      size: Math.max(16, bytes),
      usage: TENSOR_USAGE,
      label: `molgpu:nn:${label}`,
    });
    if (data?.length) {
      this.device.queue.writeBuffer(
        buffer,
        0,
        data.buffer,
        data.byteOffset,
        bytes,
      );
    }
    this.#owned.add(buffer);
    return { buffer, shape: [...shape], dtype, owned: true };
  }

  #dispatch(
    key: string,
    code: string,
    params: readonly number[],
    buffers: readonly (GPUBuffer | GPUBufferBinding)[],
    threads: number,
  ): void {
    if (threads === 0) return;
    let pipeline = this.#pipelines.get(key);
    if (!pipeline) {
      pipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: {
          module: this.device.createShaderModule({
            code,
            label: `molgpu:nn:${key}`,
          }),
          entryPoint: "main",
        },
        label: `molgpu:nn:${key}`,
      });
      this.#pipelines.set(key, pipeline);
    }
    const uniform = this.device.createBuffer({
      size: 4 * PARAM_SLOTS,
      usage: UNIFORM | COPY_DST,
      label: `molgpu:nn:${key}:params`,
    });
    const words = new Uint32Array(PARAM_SLOTS);
    words.set(params);
    this.device.queue.writeBuffer(uniform, 0, words);
    this.#pendingUniforms.push(uniform);
    const group = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [uniform, ...buffers].map((buffer, binding) => ({
        binding,
        resource: "buffer" in buffer ? buffer : { buffer },
      })),
    });
    const groups = Math.ceil(threads / WORKGROUP);
    const x = Math.min(groups, MAX_GROUPS);
    this.#encoder ??= this.device.createCommandEncoder();
    const pass = this.#encoder.beginComputePass({ label: `molgpu:nn:${key}` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
    pass.end();
  }
}

function floats(...tensors: (GpuTensor | undefined)[]): void {
  for (const t of tensors) {
    if (t && t.dtype !== "f32") throw new Error("expected an f32 tensor");
  }
}

function f32Bits(value: number): number {
  return new Uint32Array(new Float32Array([value]).buffer)[0];
}
