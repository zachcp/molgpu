// Every ProteinMPNN weight matrix as a plane in 3D, coloured by a fragment
// shader that reads the same GPUBuffer the forward pass reads. "Stacked" piles
// the planes along z in forward-pass order and blends them additively, so the
// stack reads as a glowing volume; "unstacked" flies them out (staggered, in
// order) into a flat grid with one column per layer. Both read left to right:
// edge features first, output last. Raw WebGPU: a camera
// uniform, one small uniform per plane, and the weight buffers themselves.
import type { MatrixView } from "./run.ts";

const SHADER = /* wgsl */ `
struct Camera { viewProj: mat4x4<f32> }
struct Plane {
  center: vec3<f32>, alpha: f32,
  size: vec2<f32>, rows: u32, cols: u32,
  scale: f32, highlight: f32, pad: vec2<f32>,
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
  let p = plane.center + local * vec3<f32>(plane.size, plane.pad.x);
  var out: Out;
  out.position = camera.viewProj * vec4<f32>(p, 1.0);
  // Columns run along x (inputs), rows down y (outputs); sides take border cells.
  out.uv = clamp(vec2<f32>(local.x + 0.5, 0.5 - local.y), vec2<f32>(0.0), vec2<f32>(0.9999));
  out.side = select(0u, 1u, i >= 12u);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
  let row = min(u32(in.uv.y * f32(plane.rows)), plane.rows - 1u);
  let col = min(u32(in.uv.x * f32(plane.cols)), plane.cols - 1u);
  let t = values[row * plane.cols + col] / plane.scale;
  let hue = select(vec3<f32>(0.25, 0.62, 1.0), vec3<f32>(1.0, 0.55, 0.15), t > 0.0);
  var color = hue * pow(clamp(abs(t), 0.0, 1.0), 0.7) * plane.alpha;
  let frame = mix(vec3<f32>(0.07), vec3<f32>(1.0, 0.92, 0.3), plane.highlight);
  if (in.side == 1u) {
    // Slab edges: a solid tint so the thickness reads from the side.
    return vec4<f32>(color * 0.6 + vec3<f32>(0.05, 0.09, 0.14) + frame * 0.6, 1.0);
  }
  let edge = min(min(in.uv.x, 1.0 - in.uv.x) * plane.size.x,
                 min(in.uv.y, 1.0 - in.uv.y) * plane.size.y);
  if (edge < 0.08) { color += frame; }
  return vec4<f32>(color, 1.0);
}
`;

type Vec3 = [number, number, number];
const CELL = 1 / 32; // world units per matrix cell
const STAGGER = 0.6; // fraction of the transition spent staggering planes
const DURATION = 1600; // ms for a full stack <-> unstack transition
const FOV = 0.8;
// Looking from -x, the stack's +z (later steps) runs to the right on screen,
// so the forward pass reads left to right as in the unstacked grid.
const STACK_VIEW = { yaw: -0.85, pitch: 0.42 };
const FLAT_VIEW = { yaw: 0, pitch: 0 };

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

/** Column in the unstacked grid: one per stage of the forward pass. */
const groupOf = (name: string) => {
  const layer = /^(encoder|decoder)_layers\.(\d+)\./.exec(name);
  if (layer) {
    return `${layer[1] === "encoder" ? "Encoder" : "Decoder"} ${
      Number(layer[2]) + 1
    }`;
  }
  if (name === "W_s.weight") return "Sequence";
  if (name === "W_out.weight") return "Output";
  return "Edge features";
};

interface Plane {
  readonly view: MatrixView;
  readonly index: number;
  readonly order: number;
  readonly size: [number, number];
  readonly flat: Vec3;
  readonly uniform: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  /** Centre drawn last frame, for picking. */
  center: Vec3;
}

const pipelines = new WeakMap<GPUDevice, Map<string, GPURenderPipeline>>();

/** The 3D weights view; `onSelect` receives a matrix index into `matrices`. */
export class Weights3D {
  readonly canvas: HTMLCanvasElement;
  #device: GPUDevice;
  #context: GPUCanvasContext;
  #pipeline: GPURenderPipeline;
  #camera: GPUBuffer;
  #planes: Plane[] = [];
  #flatSize: [number, number] = [1, 1];
  #tip: HTMLElement;
  #onSelect: (index: number) => void;
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
  /** Checkpoint names the current forward-pass step reads, or null for no focus. */
  #focus: ReadonlySet<string> | null = null;
  #eye: Vec3 = [0, 0, 1];
  #basis: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    tip: HTMLElement,
    matrices: readonly MatrixView[],
    onSelect: (index: number) => void,
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
        label: "mpnn:weights3d",
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
        label: "mpnn:weights3d",
      });
      cache.set(format, pipeline);
    }
    this.#pipeline = pipeline;
    this.#camera = device.createBuffer({
      size: 64,
      usage: 0x0040 | 0x0008, // UNIFORM | COPY_DST
      label: "mpnn:weights3d:camera",
    });
    this.#layout(matrices);
    this.#bindEvents();
    this.#resize = new ResizeObserver(() => this.draw());
    this.#resize.observe(canvas);
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
   * Light the matrices a forward-pass step reads and dim the rest; in the
   * stack they also slide out sideways. An empty list dims every matrix (a
   * step with no weights); null clears the focus.
   */
  focus(names: readonly string[] | null): void {
    this.#focus = names && new Set(names);
    this.canvas.dataset.focus = names?.join(" ") ?? "";
    this.draw();
  }

  /** Spacing between stacked planes in world units. */
  setGap(gap: number): void {
    this.#gap = gap;
    this.draw();
  }

  #layout(matrices: readonly MatrixView[]): void {
    const real = matrices
      .map((view, index) => ({ view, index }))
      .filter(({ view }) => view.name);
    // Unstacked grid: layers as columns, matrices top-down in each column.
    const groups = new Map<string, typeof real>();
    for (const entry of real) {
      const key = groupOf(entry.view.name!);
      groups.set(key, [...groups.get(key) ?? [], entry]);
    }
    const columns = [...groups.values()].map((entries) => {
      const sizes = entries.map(({ view }) =>
        [view.tensor.shape[1] * CELL, view.tensor.shape[0] * CELL] as [
          number,
          number,
        ]
      );
      return {
        entries,
        sizes,
        // Wide enough for the stage label even when its matrices are narrow.
        width: Math.max(9, ...sizes.map((s) => s[0])),
        height: sizes.reduce((h, s) => h + s[1], 0) + 1 * (sizes.length - 1),
      };
    });
    const GAP = 3;
    const overlay = this.#tip.parentElement!;
    const width = columns.reduce((w, c) => w + c.width, 0) +
      GAP * (columns.length - 1);
    const height = Math.max(...columns.map((c) => c.height));
    this.#flatSize = [width, height];
    let x = -width / 2, order = 0;
    for (
      const [key, column] of [...groups.keys()].map((k, i) =>
        [k, columns[i]] as const
      )
    ) {
      let y = height / 2;
      const first = this.#planes.length;
      column.entries.forEach(({ view, index }, i) => {
        const size = column.sizes[i];
        const uniform = this.#device.createBuffer({
          size: 48,
          usage: 0x0040 | 0x0008,
          label: `mpnn:weights3d:${view.name}`,
        });
        this.#planes.push({
          view,
          index,
          order: order++,
          size,
          flat: [x + column.width / 2, y - size[1] / 2, 0],
          uniform,
          bindGroup: this.#device.createBindGroup({
            layout: this.#pipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: this.#camera } },
              { binding: 1, resource: { buffer: uniform } },
              { binding: 2, resource: { buffer: view.tensor.buffer } },
            ],
          }),
          center: [0, 0, 0],
        });
        y -= size[1] + 1;
      });
      const element = document.createElement("div");
      element.className = "mpnn-stage";
      element.textContent = key;
      overlay.append(element);
      this.#labels.push({ element, plane: this.#planes[first] });
      x += column.width + GAP;
    }
    // `matrices` is in forward-pass order; that sets the stack and the stagger.
    this.#planes.sort((a, b) => a.index - b.index);
    this.#planes.forEach((plane, i) => (plane as { order: number }).order = i);
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
      if (!moving) {
        this.canvas.dataset.arrangement = this.mode;
      }
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
    // Fit the stack or the grid, blending between them as planes move.
    const stackRadius = Math.max(22, n * this.#gap * 0.9) * 1.2;
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
      x[0],
      y[0],
      z[0],
      0,
      x[1],
      y[1],
      z[1],
      0,
      x[2],
      y[2],
      z[2],
      0,
      -dot(x, eye),
      -dot(y, eye),
      -dot(z, eye),
      1,
    ];
    const near = radius * 0.01, far = radius * 10, f = 1 / tan;
    const proj = [
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      far / (near - far),
      -1,
      0,
      0,
      (near * far) / (near - far),
      0,
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
      const stackZ = (plane.order - (n - 1) / 2) * this.#gap;
      // Planes lift out of the stack on an arc before settling in the grid.
      const focused = this.#focus?.has(plane.view.name!) ?? false;
      // Focused planes rise out of the stack, keeping their place in the order.
      const pop = focused ? (plane.size[1] * 0.5 + 3) * (1 - p) : 0;
      plane.center = [
        plane.flat[0] * p,
        plane.flat[1] * p + pop,
        stackZ * (1 - p) + Math.sin(Math.PI * p) * 10,
      ];
      floats.set(plane.center, 0);
      // Dimmer while stacked (overlaps add up); a focus dims the rest further.
      const alpha = 0.4 + 0.6 * p;
      floats[3] = !this.#focus ? alpha : focused ? 1 : alpha * 0.18;
      floats.set(plane.size, 4);
      words[6] = plane.view.tensor.shape[0];
      words[7] = plane.view.tensor.shape[1];
      floats[8] = plane.view.scale;
      floats[9] = plane === this.#hovered || focused ? 1 : 0;
      // Slab thickness: visible from the side, never thicker than the gap.
      floats[10] = Math.min(0.35, this.#gap * 0.6);
      this.#device.queue.writeBuffer(plane.uniform, 0, data);
      pass.setBindGroup(0, plane.bindGroup);
      pass.draw(36);
    }
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
    this.#placeLabels();
  }

  /** Pin each stage label above its column's first plane, wherever it is now. */
  #placeLabels(): void {
    const m = this.#viewProj;
    const box = this.canvas.getBoundingClientRect();
    for (const { element, plane } of this.#labels) {
      const p = [
        plane.center[0],
        plane.center[1] + plane.size[1] / 2 + 0.4,
        plane.center[2],
        1,
      ];
      const clip = [0, 1, 2, 3].map((r) =>
        m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3]
      );
      const visible = clip[3] > 0;
      element.hidden = !visible;
      if (!visible) continue;
      element.style.left = `${(clip[0] / clip[3] * 0.5 + 0.5) * box.width}px`;
      element.style.top = `${(0.5 - clip[1] / clip[3] * 0.5) * box.height}px`;
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
      const [rows, cols] = plane.view.tensor.shape;
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
        const { view } = hit.plane;
        const value = view.values[hit.row * view.tensor.shape[1] + hit.col];
        this.#tip.hidden = false;
        this.#tip.textContent =
          `${view.label} · out ${hit.row}, in ${hit.col} = ${value.toFixed(4)}`;
        const box = canvas.getBoundingClientRect();
        this.#tip.style.left = `${event.clientX - box.left + 12}px`;
        this.#tip.style.top = `${event.clientY - box.top + 12}px`;
        canvas.dataset.hoveredWeight = view.name;
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
      if (hit) this.#onSelect(hit.plane.index);
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
        0.15,
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
    for (const plane of this.#planes) plane.uniform.destroy();
    for (const { element } of this.#labels) element.remove();
  }
}
