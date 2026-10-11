// x0p: native PointLayer, pass-aware sizing candidate, and tessellated reference.
// Experimental fixture only: no production renderer or public API changes.
import { render, unmount, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  Environment,
  FaceLayer,
  NormalMaterial,
  OrbitCamera,
  Pass,
  PBRMaterial,
  PointLayer,
  RawData,
  useDeviceContext,
  useShader,
} from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { getWorldScale } from "@use-gpu/wgsl/use/view.wgsl";
import { WorldSpacePointLayer } from "../src/representations/world-space-points.ts";

const probe = globalThis.__sphere = {
  errors: [],
  draws: 0,
  storage: 0,
  storageWrites: 0,
  objectDraws: 0,
  pendingPipelines: 0,
  shadowDraws: 0,
};
const storageBuffers = new WeakSet();
const create = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  if (desc.usage & GPUBufferUsage.STORAGE) probe.storage++;
  const buffer = create.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) storageBuffers.add(buffer);
  return buffer;
};
const write = GPUQueue.prototype.writeBuffer;
GPUQueue.prototype.writeBuffer = function (buffer, ...args) {
  // The 100k molecular columns are 400k/1.6M bytes. Exclude native light
  // storage, which is legitimately rewritten while shadow views change.
  if (storageBuffers.has(buffer) && buffer.size >= 400000) {
    probe.storageWrites++;
  }
  return write.call(this, buffer, ...args);
};
const pipeline = GPUDevice.prototype.createRenderPipelineAsync;
GPUDevice.prototype.createRenderPipelineAsync = async function (descriptor) {
  probe.pendingPipelines++;
  try {
    return await pipeline.call(this, descriptor);
  } finally {
    probe.pendingPipelines--;
  }
};
const shadowPasses = new WeakSet();
const colorPasses = new WeakSet();
const begin = GPUCommandEncoder.prototype.beginRenderPass;
GPUCommandEncoder.prototype.beginRenderPass = function (descriptor) {
  const pass = begin.call(this, descriptor);
  if (descriptor.label?.includes("ShadowPass")) shadowPasses.add(pass);
  if (descriptor.label === "ColorPass") colorPasses.add(pass);
  return pass;
};
const draw = GPURenderPassEncoder.prototype.draw;
GPURenderPassEncoder.prototype.draw = function (...args) {
  probe.draws++;
  if (shadowPasses.has(this)) probe.shadowDraws++;
  if (
    colorPasses.has(this) && (args[0] === 4 || (args[0] === 3 && args[1] > 2))
  ) probe.objectDraws++;
  return draw.apply(this, args);
};
const SIZE = wgsl`
@link fn getWorldScale(w: f32, depth: f32) -> f32;
@link fn getRadius(i: u32) -> f32;
@export fn getSize(i: u32) -> f32 { return 2.0 * getRadius(i) / getWorldScale(1.0, 1.0); }
`;
const PassAwarePoints = (props) =>
  use(PointLayer, {
    ...props,
    depth: 1,
    sizes: useShader(SIZE, [getWorldScale, props.radii]),
  });
const centers = [[-0.65, 0, 0.2], [0.65, 0, -0.2]];
const colors = [[0.9, 0.1, 0.1, 1], [0.1, 0.3, 0.9, 1]];
// A high-resolution mesh oracle for visible intersections, not a production mesh path.
const positions = [], normals = [], meshColors = [];
const vertex = (theta, phi, center, color) => {
  const n = [
    Math.sin(theta) * Math.cos(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.sin(phi),
  ];
  positions.push(...n.map((v, i) => v + center[i]), 1);
  normals.push(...n, 0);
  meshColors.push(...color);
};
for (let k = 0; k < centers.length; k++) {
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 96; x++) {
      const t = y * Math.PI / 48, t1 = (y + 1) * Math.PI / 48;
      const p = x * 2 * Math.PI / 96, p1 = (x + 1) * 2 * Math.PI / 96;
      for (
        const [a, b] of [[t, p], [t1, p1], [t1, p], [t, p], [t, p1], [t1, p1]]
      ) vertex(a, b, centers[k], colors[k]);
    }
  }
}
const column = (data, format, children) =>
  use(RawData, { data, format, children });
const mesh = (shadow) =>
  column(
    Float32Array.from(positions),
    "vec4<f32>",
    (positions) =>
      column(
        Float32Array.from(normals),
        "vec4<f32>",
        (normals) =>
          column(Float32Array.from(meshColors), "vec4<f32>", (colors) =>
            use(FaceLayer, {
              positions,
              normals,
              colors,
              shaded: true,
              shadow,
              side: "both",
            })),
      ),
  );
const datasets = new Map();
for (const count of [2, 100000]) {
  const pos = new Float32Array(count * 4), col = new Float32Array(count * 4);
  const radii = new Float32Array(count).fill(count === 2 ? 1 : 0.07);
  for (let i = 0; i < count; i++) {
    pos.set(
      count === 2 ? [...centers[i], 1] : [
        (i % 100 - 50) * 0.15,
        (Math.floor(i / 100) % 100 - 50) * 0.15,
        Math.floor(i / 10000) * 0.15,
        1,
      ],
      i * 4,
    );
    col.set(colors[i % 2], i * 4);
  }
  datasets.set(count, { pos, col, radii });
}
const points = (renderer, count, shadow) => {
  const { pos, col, radii } = datasets.get(count);
  return column(
    pos,
    "vec4<f32>",
    (positions) =>
      column(
        col,
        "vec4<f32>",
        (colors) =>
          column(radii, "f32", (radii) =>
            use(
              renderer === "current" ? WorldSpacePointLayer : PassAwarePoints,
              {
                positions,
                colors,
                radii,
                count,
                shaded: true,
                shadow,
                hard: true,
              },
            )),
      ),
  );
};
const ground = column(
  Float32Array.from([
    -6,
    -1.1,
    -6,
    1,
    6,
    -1.1,
    -6,
    1,
    6,
    -1.1,
    6,
    1,
    -6,
    -1.1,
    -6,
    1,
    6,
    -1.1,
    6,
    1,
    -6,
    -1.1,
    6,
    1,
  ]),
  "vec4<f32>",
  (positions) =>
    use(FaceLayer, {
      positions,
      normal: [0, -1, 0, 0],
      color: [0.7, 0.7, 0.7, 1],
      shaded: true,
      shadow: false,
      side: "both",
    }),
);
const params = new URLSearchParams(location.search);
const Scene = () => {
  const device = useDeviceContext();
  probe.drain = () => device.queue.onSubmittedWorkDone();
  device.onuncapturederror = (event) => probe.errors.push(event.error.message);
  const [state, setState] = useState({
    renderer: params.get("renderer") ?? "current",
    count: Number(params.get("count") ?? 2),
    shadow: params.has("shadow"),
    cast: !params.has("nocast"),
    normal: !params.has("pbr"),
    ssao: params.has("ssao"),
    bearing: 0,
    roughness: 0.5,
    environment: params.has("env") ? "park" : "none",
    dolly: params.has("ortho") ? 0 : 1,
    near: params.has("crossnear") ? 6.3 : params.has("near") ? 5.5 : 0.001,
    target: params.has("offaxis") ? [1.5, 0, 0] : [0, 0, 0],
  });
  probe.set = (next) => setState((previous) => ({ ...previous, ...next }));
  const object = state.renderer === "mesh"
    ? mesh(state.shadow && state.cast)
    : points(state.renderer, state.count, state.shadow && state.cast);
  const material = state.normal
    ? use(NormalMaterial, { children: object })
    : use(PBRMaterial, { roughness: state.roughness, children: object });
  return use(OrbitCamera, {
    radius: state.count === 2 ? 7 : 22,
    bearing: state.bearing,
    pitch: 0.15,
    target: state.target,
    dolly: state.dolly,
    near: state.near,
    children: use(Pass, {
      lights: true,
      shadows: state.shadow,
      ssao: state.ssao,
      outline: params.has("outline") ? { width: 2 } : undefined,
      children: [
        use(AmbientLight, { intensity: 0.3 }),
        use(DirectionalLight, {
          direction: [-1, -2, -1],
          intensity: 1,
          position: [8, 12, 8, 1],
          shadowMap: state.shadow
            ? {
              size: [512, 512],
              span: [12, 12],
              depth: [0.1, 30],
              bias: [0, 0.001, 0.002],
            }
            : undefined,
        }),
        state.shadow ? ground : null,
        use(Environment, { preset: state.environment, children: material }),
      ],
    }),
  });
};
const root = render(
  use(WebGPU, {
    children: use(AutoCanvas, {
      selector: "#stage",
      samples: 1,
      backgroundColor: [0, 0, 0, 1],
      children: use(Scene),
    }),
  }),
);
probe.unmount = () => unmount(root);

globalThis.addEventListener("pagehide", probe.unmount, { once: true });
