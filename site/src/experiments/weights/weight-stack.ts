// A model's weight matrices as slabs in 3D, for any `ModelLayout` from
// @molgpu/nn. "Stacked" piles the slabs along the view's left-to-right axis
// in forward order and blends them additively, so the stack reads as a
// glowing volume; "unstacked" flies them out (staggered, in order) into a
// grid with one column per stage. A matrix with a GPU buffer is coloured by a
// fragment shader reading that buffer (the same one the model reads); one
// without (a layout from a safetensors header) is a tinted slab of its true
// shape. Raw WebGPU: a camera uniform, one small uniform per slab, and the
// weight buffers themselves.
import type { ModelLayout } from "@molgpu/nn";

/** A matrix to draw: its layout entry plus, optionally, its data. */
export interface StackMatrix {
  readonly name: string;
  /** [out, in]: height and width of the slab. */
  readonly shape: readonly [number, number];
  /** Row-major f32 values to colour by; absent for shape-only slabs. */
  readonly buffer?: GPUBuffer;
  /** CPU copy of the values, for the hover readout. */
  readonly values?: Float32Array;
  /** Largest |value|, for the diverging palette. */
  readonly scale?: number;
}

export interface StackStage {
  readonly label: string;
  readonly matrices: readonly StackMatrix[];
}

/** Stages of a layout with no data: every slab drawn from its shape. */
export const shapeOnly = (layout: ModelLayout): StackStage[] =>
  layout.stages.map((s) => ({ label: s.label, matrices: s.matrices }));

const SHADER = /* wgsl */ `
struct Camera { viewProj: mat4x4<f32> }
struct Plane {
  center: vec3<f32>, alpha: f32,
  size: vec2<f32>, rows: u32, cols: u32,
  scale: f32, highlight: f32, thickness: f32, hue: f32,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> plane: Plane;
@group(0) @binding(2) var<storage, read> values: array<f32>;

struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) side: u32,
}

// A box: corner bits x = 1, y = 2, z = 4; two triangles per face, front and
// back faces first, then the four sides.
const FACES = array<u32, 36>(
  4u, 5u, 6u, 6u, 5u, 7u,   0u, 2u, 1u, 1u, 2u, 3u,
  1u, 3u, 5u, 5u, 3u, 7u,   0u, 4u, 2u, 2u, 4u, 6u,
  2u, 3u, 6u, 6u, 3u, 7u,   0u, 1u, 4u, 4u, 1u, 5u);

@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let c = FACES[i];
  let local = vec3<f32>(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u)) - 0.5;
  let p = plane.center + local * vec3<f32>(plane.size, plane.thickness);
  var out: Out;
  out.position = camera.viewProj * vec4<f32>(p, 1.0);
  // Columns run along x (inputs), rows down y (outputs); sides take border cells.
  out.uv = clamp(vec2<f32>(local.x + 0.5, 0.5 - local.y), vec2<f32>(0.0), vec2<f32>(0.9999));
  out.side = select(0u, 1u, i >= 12u);
  return out;
}

fn hueColor(h: f32) -> vec3<f32> {
  let k = vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0);
  return 0.5 + 0.35 * cos(6.2831853 * (h + k));
}

@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
  var color: vec3<f32>;
  if (plane.hue >= 0.0) {
    // Shape only: a flat stage tint with a faint 8 x 8 grid of the matrix.
    let g = fract(in.uv * 8.0);
    let line = select(0.0, 0.25, min(g.x, g.y) < 0.04);
    color = hueColor(plane.hue) * (0.22 + line) * plane.alpha;
  } else {
    let row = min(u32(in.uv.y * f32(plane.rows)), plane.rows - 1u);
    let col = min(u32(in.uv.x * f32(plane.cols)), plane.cols - 1u);
    let t = values[row * plane.cols + col] / plane.scale;
    let hue = select(vec3<f32>(0.25, 0.62, 1.0), vec3<f32>(1.0, 0.55, 0.15), t > 0.0);
    color = hue * pow(clamp(abs(t), 0.0, 1.0), 0.7) * plane.alpha;
  }
  let frame = mix(vec3<f32>(0.07), vec3<f32>(1.0, 0.92, 0.3), plane.highlight);
  if (in.side == 1u) {
    // Slab edges: a solid tint so the thickness reads from the side.
    return vec4<f32>(color * 0.6 + vec3<f32>(0.05, 0.09, 0.14) + frame * 0.6, 1.0);
  }
  let edge = min(min(in.uv.x, 1.0 - in.uv.x) * plane.size.x,
                 min(in.uv.y, 1.0 - in.uv.y) * plane.size.y);
  if (edge < plane.thickness * 0.25) { color += frame; }
  return vec4<f32>(color, 1.0);
}
`;

type Vec3 = [number, number, number];
const STAGGER = 0.6; // fraction of the transition spent staggering planes
const DURATION = 1600; // ms for a full stack <-> unstack transition
const FOV = 0.8;
/** Largest matrix side in world units; smaller models keep 1/32 per cell. */
const SPAN = 48;
// Looking from -x, the stack's +z (later stages) runs to the right on screen,
// so the forward pass reads left to right as in the unstacked grid.
const STACK_VIEW = { yaw: -0.85, pitch: 0.42 };
const FLAT_VIEW = { yaw: 0, pitch: 0 };
/** Width : height the unstacked grid wraps toward. */
const ASPECT = 1.8;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

interface Plane {
  readonly matrix: StackMatrix;
  readonly stage: number;
  readonly order: number;
  readonly size: [number, number];
  readonly flat: Vec3;
  readonly uniform: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  /** Centre drawn last frame, for picking. */
  center: Vec3;
}

const pipelines = new WeakMap<GPUDevice, Map<string, GPURenderPipeline>>();

/** The 3D weights view; `onSelect` receives the clicked matrix's name. */
export class WeightStack {
  readonly canvas: HTMLCanvasElement;
  #device: GPUDevice;
  #context: GPUCanvasContext;
  #pipeline: GPURenderPipeline;
  #camera: GPUBuffer;
  #placeholder: GPUBuffer;
  #planes: Plane[] = [];
  #stages = 0;
  #cell = 1 / 32;
  #largest = 1;
  #flatSize: [number, number] = [1, 1];
  #tip: HTMLElement;
  #onSelect: (name: string) => void;
  #resize: ResizeObserver;
  #labels: { element: HTMLElement; plane: Plane }[] = [];
  #viewProj = new Float32Array(16);
  #cleanup: (() => void)[] = [];
  #raf = 0;
  // Stack (0) to unstacked (1): current value, goal, and the last frame time.
  #t = 0;
  #goal = 0;
  #last = 0;
  #gap = 0.6;
  #yaw = STACK_VIEW.yaw;
  #pitch = STACK_VIEW.pitch;
  #zoom = 1;
  #view: { yaw: number; pitch: number } | null = null;
  #hovered: Plane | null = null;
  /** Names the current forward-pass step reads, or null for no focus. */
  #focus: ReadonlySet<string> | null = null;
  #eye: Vec3 = [0, 0, 1];
  #basis: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    tip: HTMLElement,
    stages: readonly StackStage[],
    onSelect: (name: string) => void = () => {},
  ) {
    this.canvas = canvas;
    this.#device = device;
    this.#tip = tip;
    this.#onSelect = onSelect;
    this.#context = canvas.getContext("webgpu") as unknown as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.#context.configure({ device, format, alphaMode: "opaque" });
    let cache = pipelines.get(device);
    if (!cache) pipelines.set(device, cache = new Map());
    let pipeline = cache.get(format);
    if (!pipeline) {
      const module = device.createShaderModule({
        code: SHADER,
        label: "weights:stack",
      });
      const add = { srcFactor: "one", dstFactor: "one", operation: "add" };
      pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs" },
        fragment: {
          module,
          entryPoint: "fs",
          targets: [{
            format,
            blend: { color: add, alpha: add } as GPUBlendState,
          }],
        },
        primitive: { cullMode: "none" },
        label: "weights:stack",
      });
      cache.set(format, pipeline);
    }
    this.#pipeline = pipeline;
    this.#camera = device.createBuffer({
      size: 64,
      usage: 0x0040 | 0x0008, // UNIFORM | COPY_DST
      label: "weights:stack:camera",
    });
    // Bound for shape-only slabs, whose shader never reads it.
    this.#placeholder = device.createBuffer({
      size: 16,
      usage: 0x0080, // STORAGE
      label: "weights:stack:placeholder",
    });
    this.#layout(stages);
    this.#bindEvents();
    this.#resize = new ResizeObserver(() => this.draw());
    this.#resize.observe(canvas);
    canvas.dataset.planes = String(this.#planes.length);
  }

  /** "stacked" or "unstacked", the state the view is heading to. */
  get mode(): "stacked" | "unstacked" {
    return this.#goal ? "unstacked" : "stacked";
  }

  /** Animate to the other arrangement and its default camera angle. */
  toggle(): "stacked" | "unstacked" {
    this.#goal = 1 - this.#goal;
    this.#view = this.#goal ? FLAT_VIEW : STACK_VIEW;
    this.#animate();
    return this.mode;
  }

  /**
   * Light the named matrices and dim the rest; in the stack they also rise
   * out of it. An empty list dims every matrix; null clears the focus.
   */
  focus(names: readonly string[] | null): void {
    this.#focus = names && new Set(names);
    this.canvas.dataset.focus = names?.join(" ") ?? "";
    this.draw();
  }

  /** Spacing between stacked planes, in units of 1/16 of the largest matrix side. */
  setGap(gap: number): void {
    this.#gap = gap;
    this.draw();
  }

  #layout(stages: readonly StackStage[]): void {
    this.#stages = stages.length;
    const largest = Math.max(
      1,
      ...stages.flatMap((s) => s.matrices.flatMap((m) => m.shape)),
    );
    // Small models keep 32 cells per world unit; large ones shrink so the
    // largest side spans SPAN units. Every slab keeps its true proportions.
    this.#cell = Math.min(1 / 32, SPAN / largest);
    this.#largest = largest * this.#cell;
    const unit = this.#largest / 16;
    const columns = stages.map(({ matrices }) => {
      const sizes = matrices.map(({ shape }) =>
        [shape[1] * this.#cell, shape[0] * this.#cell] as [number, number]
      );
      return {
        sizes,
        width: Math.max(...sizes.map((s) => s[0])),
        height: sizes.reduce((h, s) => h + s[1], 0) +
          unit * (sizes.length - 1),
      };
    });
    const gap = 3 * unit;
    // Wrap stages into rows, reading order, so the grid is about as wide as
    // it is tall times ASPECT instead of one long strip for deep models.
    const total = columns.reduce((w, c) => w + c.width + gap, -gap);
    const tallest = Math.max(...columns.map((c) => c.height)) + 2 * gap;
    const rowCount = Math.max(
      1,
      Math.min(
        columns.length,
        Math.round(Math.sqrt(total / (ASPECT * tallest))),
      ),
    );
    const rowWidth = total / rowCount;
    const rows: number[][] = [[]];
    let filled = 0;
    columns.forEach((column, s) => {
      if (filled > 0 && filled + column.width / 2 > rowWidth * rows.length) {
        rows.push([]);
      }
      rows.at(-1)!.push(s);
      filled += column.width + gap;
    });
    const rowSize = rows.map((row) => ({
      width: row.reduce((w, s) => w + columns[s].width + gap, -gap),
      height: Math.max(...row.map((s) => columns[s].height)) + 2 * gap,
    }));
    const width = Math.max(...rowSize.map((r) => r.width));
    const height = rowSize.reduce((h, r) => h + r.height, 0);
    this.#flatSize = [width, height];
    const origin = new Map<number, [number, number]>();
    let top = height / 2;
    rows.forEach((row, r) => {
      let x = -rowSize[r].width / 2;
      for (const s of row) {
        origin.set(s, [x, top - 2 * gap]);
        x += columns[s].width + gap;
      }
      top -= rowSize[r].height;
    });
    const overlay = this.#tip.parentElement!;
    let order = 0;
    stages.forEach((stage, s) => {
      const column = columns[s];
      const [x] = origin.get(s)!;
      let y = origin.get(s)![1];
      const first = this.#planes.length;
      stage.matrices.forEach((matrix, i) => {
        const size = column.sizes[i];
        const uniform = this.#device.createBuffer({
          size: 48,
          usage: 0x0040 | 0x0008,
          label: `weights:stack:${matrix.name}`,
        });
        this.#planes.push({
          matrix,
          stage: s,
          order: order++,
          size,
          flat: [x + column.width / 2, y - size[1] / 2, 0],
          uniform,
          bindGroup: this.#device.createBindGroup({
            layout: this.#pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.#camera } },
              { binding: 1, resource: { buffer: uniform } },
              {
                binding: 2,
                resource: { buffer: matrix.buffer ?? this.#placeholder },
              },
            ],
          }),
          center: [0, 0, 0],
        });
        y -= size[1] + unit;
      });
      if (!stage.matrices.length) return;
      const element = document.createElement("div");
      element.className = "weights-stage";
      element.textContent = stage.label;
      overlay.append(element);
      this.#labels.push({ element, plane: this.#planes[first] });
    });
  }

  /** Per-plane transition progress: earlier planes move first. */
  #progress(plane: Plane): number {
    const f = plane.order / Math.max(1, this.#planes.length - 1);
    return smooth(this.#t * (1 + STAGGER) - STAGGER * f);
  }

  #animate(): void {
    if (this.#raf) return;
    this.#last = performance.now();
    const step = (now: number) => {
      const dt = now - this.#last;
      this.#last = now;
      const dir = Math.sign(this.#goal - this.#t);
      this.#t = Math.min(1, Math.max(0, this.#t + (dir * dt) / DURATION));
      let moving = this.#t !== this.#goal;
      if (this.#view) {
        const k = 1 - Math.exp(-dt / 220);
        this.#yaw += (this.#view.yaw - this.#yaw) * k;
        this.#pitch += (this.#view.pitch - this.#pitch) * k;
        if (
          Math.abs(this.#view.yaw - this.#yaw) +
              Math.abs(this.#view.pitch - this.#pitch) < 1e-3
        ) this.#view = null;
        else moving = true;
      }
      this.draw();
      this.#raf = moving ? requestAnimationFrame(step) : 0;
      if (!moving) this.canvas.dataset.arrangement = this.mode;
    };
    this.#raf = requestAnimationFrame(step);
  }

  draw(): void {
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const aspect = width / height;
    const n = this.#planes.length;
    const tan = Math.tan(FOV / 2);
    const unit = this.#largest / 16;
    // Fit the stack or the grid, blending between them as planes move.
    const step = this.#gap * Math.min(unit, (2 * this.#largest) / n);
    const stackRadius = Math.max(this.#largest * 0.7, n * step) * 1.2;
    const [fw, fh] = this.#flatSize;
    const flatRadius = Math.max(fw / aspect, fh) / (2 * tan) * 1.08;
    const radius =
      (stackRadius + (flatRadius - stackRadius) * smooth(this.#t)) *
      this.#zoom;
    const cp = Math.cos(this.#pitch);
    const eye: Vec3 = [
      radius * cp * Math.sin(this.#yaw),
      radius * Math.sin(this.#pitch),
      radius * cp * Math.cos(this.#yaw),
    ];
    const z = normalize(eye); // target is the origin
    const x = normalize(cross([0, 1, 0], z));
    const y = cross(z, x);
    this.#eye = eye;
    this.#basis = [x, y, [-z[0], -z[1], -z[2]]];
    const view = [
      ...[x[0], y[0], z[0], 0],
      ...[x[1], y[1], z[1], 0],
      ...[x[2], y[2], z[2], 0],
      ...[-dot(x, eye), -dot(y, eye), -dot(z, eye), 1],
    ];
    const near = radius * 0.01, far = radius * 10, f = 1 / tan;
    const proj = [
      ...[f / aspect, 0, 0, 0],
      ...[0, f, 0, 0],
      ...[0, 0, far / (near - far), -1],
      ...[0, 0, (near * far) / (near - far), 0],
    ];
    const viewProj = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += proj[k * 4 + r] * view[c * 4 + k];
        viewProj[c * 4 + r] = sum;
      }
    }
    this.#device.queue.writeBuffer(this.#camera, 0, viewProj);
    this.#viewProj = viewProj;

    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.#context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: [0.005, 0.008, 0.016, 1],
      }],
    });
    pass.setPipeline(this.#pipeline);
    const data = new ArrayBuffer(48);
    const floats = new Float32Array(data), words = new Uint32Array(data);
    for (const plane of this.#planes) {
      const p = this.#progress(plane);
      const stackZ = (plane.order - (n - 1) / 2) * step;
      const focused = this.#focus?.has(plane.matrix.name) ?? false;
      // Focused planes rise out of the stack, keeping their place in the order.
      const pop = focused ? (plane.size[1] * 0.5 + 3 * unit) * (1 - p) : 0;
      plane.center = [
        plane.flat[0] * p,
        plane.flat[1] * p + pop,
        stackZ * (1 - p) + Math.sin(Math.PI * p) * 10 * unit,
      ];
      floats.set(plane.center, 0);
      // Dimmer while stacked (overlaps add up); a focus dims the rest further.
      const alpha = 0.4 + 0.6 * p;
      floats[3] = !this.#focus ? alpha : focused ? 1 : alpha * 0.18;
      floats.set(plane.size, 4);
      words[6] = plane.matrix.shape[0];
      words[7] = plane.matrix.shape[1];
      floats[8] = plane.matrix.scale ?? 1;
      floats[9] = plane === this.#hovered || focused ? 1 : 0;
      // Slab thickness: visible from the side, never thicker than the gap.
      floats[10] = Math.min(0.35 * unit, step * 0.6);
      floats[11] = plane.matrix.buffer
        ? -1
        : (plane.stage / Math.max(1, this.#stages)) * 0.8;
      this.#device.queue.writeBuffer(plane.uniform, 0, data);
      pass.setBindGroup(0, plane.bindGroup);
      pass.draw(36);
    }
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
    this.#placeLabels();
  }

  /** Pin each stage label above its first plane; skip labels that would collide. */
  #placeLabels(): void {
    const m = this.#viewProj;
    const box = this.canvas.getBoundingClientRect();
    const placed: [number, number, number][] = [];
    for (const { element, plane } of this.#labels) {
      const p = [
        plane.center[0],
        plane.center[1] + plane.size[1] / 2 + this.#largest / 80,
        plane.center[2],
        1,
      ];
      const clip = [0, 1, 2, 3].map((r) =>
        m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3]
      );
      const left = (clip[0] / clip[3] * 0.5 + 0.5) * box.width;
      const top = (0.5 - clip[1] / clip[3] * 0.5) * box.height;
      // Approximate label width from its text: 0.72rem bold is about 7 px a character.
      const half = (element.textContent!.length * 7 + 14) / 2;
      const visible = clip[3] > 0 &&
        placed.every(([l, t, w]) =>
          Math.abs(l - left) > w + half || Math.abs(t - top) > 18
        );
      element.hidden = !visible;
      if (!visible) continue;
      placed.push([left, top, half]);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }
  }

  /** Nearest plane under a pointer event, with the cell it hits. */
  #pick(event: PointerEvent) {
    const box = this.canvas.getBoundingClientRect();
    const tan = Math.tan(FOV / 2), aspect = box.width / box.height;
    const nx = ((event.clientX - box.left) / box.width) * 2 - 1;
    const ny = 1 - ((event.clientY - box.top) / box.height) * 2;
    const [x, y, forward] = this.#basis;
    const dir: Vec3 = [0, 1, 2].map((i) =>
      forward[i] + x[i] * nx * tan * aspect + y[i] * ny * tan
    ) as Vec3;
    let best: { plane: Plane; row: number; col: number; t: number } | null =
      null;
    for (const plane of this.#planes) {
      if (Math.abs(dir[2]) < 1e-9) continue;
      const t = (plane.center[2] - this.#eye[2]) / dir[2];
      if (t <= 0 || (best && t >= best.t)) continue;
      const hit = sub(
        [this.#eye[0] + t * dir[0], this.#eye[1] + t * dir[1], 0],
        [plane.center[0], plane.center[1], 0],
      );
      const u = hit[0] / plane.size[0] + 0.5;
      const v = 0.5 - hit[1] / plane.size[1];
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const [rows, cols] = plane.matrix.shape;
      best = {
        plane,
        row: Math.floor(v * rows),
        col: Math.floor(u * cols),
        t,
      };
    }
    return best;
  }

  #bindEvents(): void {
    const canvas = this.canvas;
    let drag: { x: number; y: number; moved: number } | null = null;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, handler, options);
      this.#cleanup.push(() => canvas.removeEventListener(type, handler));
    };
    on("pointerdown", (event) => {
      drag = { x: event.clientX, y: event.clientY, moved: 0 };
      canvas.setPointerCapture(event.pointerId);
    });
    on("pointermove", (event) => {
      if (drag) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        this.#view = null;
        this.#yaw -= dx * 0.006;
        this.#pitch = Math.max(-1.45, Math.min(1.45, this.#pitch + dy * 0.006));
        this.draw();
        return;
      }
      const hit = this.#pick(event);
      const changed = (hit?.plane ?? null) !== this.#hovered;
      this.#hovered = hit?.plane ?? null;
      if (hit) {
        const { matrix } = hit.plane;
        const value = matrix.values?.[hit.row * matrix.shape[1] + hit.col];
        this.#tip.hidden = false;
        this.#tip.textContent = `${matrix.name} [${
          matrix.shape.join(" × ")
        }] · out ${hit.row}, in ${hit.col}${
          value === undefined ? "" : ` = ${value.toFixed(4)}`
        }`;
        const box = canvas.getBoundingClientRect();
        this.#tip.style.left = `${event.clientX - box.left + 12}px`;
        this.#tip.style.top = `${event.clientY - box.top + 12}px`;
        canvas.dataset.hoveredWeight = matrix.name;
      } else {
        this.#tip.hidden = true;
        delete canvas.dataset.hoveredWeight;
      }
      if (changed && !this.#raf) this.draw();
    });
    on("pointerup", (event) => {
      const click = drag && drag.moved < 4;
      drag = null;
      if (!click) return;
      const hit = this.#pick(event);
      if (hit) this.#onSelect(hit.plane.matrix.name);
    });
    on("pointerleave", () => {
      this.#tip.hidden = true;
      if (this.#hovered) {
        this.#hovered = null;
        this.draw();
      }
    });
    on("wheel", (event) => {
      event.preventDefault();
      this.#zoom = Math.max(
        0.05,
        Math.min(4, this.#zoom * Math.exp(event.deltaY * 0.001)),
      );
      this.draw();
    }, { passive: false });
  }

  destroy(): void {
    cancelAnimationFrame(this.#raf);
    this.#resize.disconnect();
    for (const remove of this.#cleanup) remove();
    this.#context.unconfigure();
    this.#camera.destroy();
    this.#placeholder.destroy();
    for (const plane of this.#planes) plane.uniform.destroy();
    for (const { element } of this.#labels) element.remove();
  }
}
