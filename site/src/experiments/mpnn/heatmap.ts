// A heatmap drawn by raw WebGPU straight from a storage buffer: the fragment
// shader reads the same GPUBuffer a model op reads or wrote, so what you see
// is the in-memory tensor, with no CPU copy in between.

/** How cell values map to colour. */
export type HeatmapPalette =
  /** Signed values over [-scale, scale]: blue, black, orange. */
  | "diverging"
  /** Log-probabilities, shown as probability exp(v)^(1/scale). */
  | "probability"
  /** Non-negative values over [0, scale], dark to bright. */
  | "magnitude";

export interface HeatmapOptions {
  /** Row-major [rows, cols] f32 matrix at the start of `buffer`. */
  readonly rows: number;
  readonly cols: number;
  readonly palette: HeatmapPalette;
  readonly scale: number;
  /** Draw rows along x (one column of pixels per row), e.g. residues across. */
  readonly transpose?: boolean;
}

const SHADER = /* wgsl */ `
struct View {
  rows: u32, cols: u32, palette: u32, transpose: u32,
  scale: f32, highlight: i32, width: f32, height: f32,
}
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> values: array<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn diverging(t: f32) -> vec3<f32> {
  let a = clamp(abs(t), 0.0, 1.0);
  let hue = select(vec3<f32>(0.25, 0.62, 1.0), vec3<f32>(1.0, 0.55, 0.15), t > 0.0);
  return hue * pow(a, 0.7);
}

fn magma(t: f32) -> vec3<f32> {
  let x = clamp(t, 0.0, 1.0);
  let c0 = vec3<f32>(0.02, 0.02, 0.08);
  let c1 = vec3<f32>(0.55, 0.12, 0.5);
  let c2 = vec3<f32>(0.98, 0.5, 0.25);
  let c3 = vec3<f32>(0.99, 0.98, 0.75);
  if (x < 0.33) { return mix(c0, c1, x / 0.33); }
  if (x < 0.66) { return mix(c1, c2, (x - 0.33) / 0.33); }
  return mix(c2, c3, (x - 0.66) / 0.34);
}

@fragment fn fs(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
  let u = at.x / view.width;
  let v = at.y / view.height;
  var row: u32;
  var col: u32;
  if (view.transpose == 1u) {
    row = min(u32(u * f32(view.rows)), view.rows - 1u);
    col = min(u32(v * f32(view.cols)), view.cols - 1u);
  } else {
    row = min(u32(v * f32(view.rows)), view.rows - 1u);
    col = min(u32(u * f32(view.cols)), view.cols - 1u);
  }
  let value = values[row * view.cols + col];
  var color: vec3<f32>;
  if (view.palette == 1u) {
    color = magma(pow(exp(value), 1.0 / view.scale));
  } else if (view.palette == 2u) {
    color = magma(value / view.scale);
  } else {
    color = diverging(value / view.scale);
  }
  if (i32(row) == view.highlight) {
    color = mix(color, vec3<f32>(1.0, 0.92, 0.3), 0.35);
  }
  return vec4<f32>(color, 1.0);
}
`;

const pipelines = new WeakMap<GPUDevice, Map<string, GPURenderPipeline>>();

/** One canvas showing one matrix; redraws on resize and highlight changes. */
export class Heatmap {
  readonly canvas: HTMLCanvasElement;
  #device: GPUDevice;
  #context: GPUCanvasContext;
  #pipeline: GPURenderPipeline;
  #uniform: GPUBuffer;
  #group: GPUBindGroup;
  #options: HeatmapOptions;
  #highlight = -1;
  #resize: ResizeObserver;

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    buffer: GPUBuffer,
    options: HeatmapOptions,
  ) {
    this.canvas = canvas;
    this.#device = device;
    this.#options = options;
    this.#context = canvas.getContext("webgpu") as unknown as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.#context.configure({ device, format, alphaMode: "opaque" });
    let cache = pipelines.get(device);
    if (!cache) pipelines.set(device, cache = new Map());
    let pipeline = cache.get(format);
    if (!pipeline) {
      const module = device.createShaderModule({
        code: SHADER,
        label: "mpnn:heatmap",
      });
      pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format }] },
        label: "mpnn:heatmap",
      });
      cache.set(format, pipeline);
    }
    this.#pipeline = pipeline;
    this.#uniform = device.createBuffer({
      size: 32,
      usage: 0x0040 | 0x0008, // UNIFORM | COPY_DST
      label: "mpnn:heatmap:view",
    });
    this.#group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#uniform } },
        { binding: 1, resource: { buffer } },
      ],
    });
    this.#resize = new ResizeObserver(() => this.draw());
    this.#resize.observe(canvas);
  }

  /** Row under a client-space point, or -1. */
  rowAt(event: MouseEvent): number {
    const box = this.canvas.getBoundingClientRect();
    const { rows, transpose } = this.#options;
    const t = transpose
      ? (event.clientX - box.left) / box.width
      : (event.clientY - box.top) / box.height;
    return t >= 0 && t < 1 ? Math.floor(t * rows) : -1;
  }

  /** Tint one row (a residue on residue-indexed maps); -1 for none. */
  highlight(row: number): void {
    if (row === this.#highlight) return;
    this.#highlight = row;
    this.draw();
  }

  draw(): void {
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const { rows, cols, palette, scale, transpose } = this.#options;
    const view = new ArrayBuffer(32);
    new Uint32Array(view, 0, 4).set([
      rows,
      cols,
      palette === "probability" ? 1 : palette === "magnitude" ? 2 : 0,
      transpose ? 1 : 0,
    ]);
    new Float32Array(view, 16, 1)[0] = scale;
    new Int32Array(view, 20, 1)[0] = this.#highlight;
    new Float32Array(view, 24, 2).set([width, height]);
    this.#device.queue.writeBuffer(this.#uniform, 0, view);
    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.#context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0, 0, 0, 1],
      }],
    });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, this.#group);
    pass.draw(3);
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.#resize.disconnect();
    this.#context.unconfigure();
    this.#uniform.destroy();
  }
}
