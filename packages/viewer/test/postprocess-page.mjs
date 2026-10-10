// hj0.2 browser proof: a use.gpu <Pass lights> draws a transparent molgpu
// molecular surface under workbench lights, and a pass constructed with
// ssao + outline + oit compiles the extra full-screen render pipelines and
// allocates the extra offscreen targets those passes need — all with zero
// WebGPU errors. OIT is the pass that matters for the transparent surface.
//
// Plain and postprocessed are DISTINCT components, so switching mode unmounts
// one and mounts the other with a fresh <Pass>. Postprocessing flags configure
// a pass at construction; reconfiguring a live pass's flags is not a supported
// path (the cached shaded pipeline would keep the old PASS bind-group layout).
import { render, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import { coordinateBounds } from "@molgpu/table";
import { attribute, colormap, constant } from "@molgpu/fields";
import {
  enableInstrumentation,
  resetCounters,
  snapshotCounters,
} from "../src/internal/instrumentation.ts";
import { structureFromBcif } from "@molgpu/io";
import { Spacefill, Structure, Surface } from "../src/index.ts";

const probe = globalThis.__probe = {
  storage: [],
  pipelines: 0,
  pendingPipelines: 0,
  textures: 0,
  errors: [],
  mounted: false,
};
const makeBuffer = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  const buffer = makeBuffer.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) {
    probe.storage.push({ capacity: desc.size });
  }
  return buffer;
};
const makeTexture = GPUDevice.prototype.createTexture;
GPUDevice.prototype.createTexture = function (desc) {
  probe.textures += 1;
  return makeTexture.call(this, desc);
};
for (const name of ["createRenderPipeline", "createRenderPipelineAsync"]) {
  const original = GPUDevice.prototype[name];
  GPUDevice.prototype[name] = function (...args) {
    probe.pipelines += 1;
    const result = original.apply(this, args);
    if (name === "createRenderPipelineAsync") {
      probe.pendingPipelines++;
      return result.finally(() => probe.pendingPipelines--);
    }
    return result;
  };
}
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener(
    "uncapturederror",
    (e) => probe.errors.push(e.error.message),
  );
  return device;
};

const bytes = new Uint8Array(
  await (await fetch("/packages/io/test/fixtures/1crn.bcif")).arrayBuffer(),
);
const data = await structureFromBcif(bytes);
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
// White isolates alpha from the flat/Field colour-space paths.
const flat = [1, 1, 1, 0.5];
const fixed = constant(flat);
const varying = colormap(attribute("element"), [
  [1, [1, 1, 1, 0.2]],
  [16, [1, 1, 1, 0.8]],
]);
const styles = {
  flat: { color: flat },
  constant: { color: fixed, mode: "transparent" },
  "constant-default": { color: fixed },
  opaque: { color: fixed, mode: "opaque" },
  varying: { color: varying, mode: "transparent" },
  "varying-default": { color: varying },
  "varying-opaque": { color: varying, mode: "opaque" },
  "varying-opacity": { color: varying, mode: "transparent", opacity: 0.6 },
  material: {
    color: [1, 1, 1, 1],
    mode: "transparent",
    material: { albedo: [1, 1, 1, 0.5] },
  },
  "material-solid": {
    color: [1, 1, 1, 1],
    mode: "transparent",
    material: { albedo: [1, 1, 1, 1] },
  },
};
Object.assign(probe, {
  enableInstrumentation,
  resetCounters,
  snapshotCounters,
});

// A translucent surface is the OIT case; a coarse resolution keeps it fast.
const Body = () => {
  const [style, setStyle] = useState("flat");
  probe.setStyle = setStyle;
  return [
    use(AmbientLight, { intensity: 0.3 }),
    use(DirectionalLight, { direction: [-1, -2, -1.5], intensity: 1 }),
    use(Structure, {
      data,
      children: [
        use(Surface, { resolution: 1.2, ...styles[style] }),
        use(Spacefill, { scale: 0.3 }),
      ],
    }),
  ];
};

// Two distinct components so switching mode remounts a fresh <Pass>.
const PlainScene = () => use(Pass, { lights: true, children: use(Body, {}) });
const PostScene = () =>
  use(Pass, {
    lights: true,
    ssao: true,
    outline: true,
    oit: true,
    children: use(Body, {}),
  });
const AlphaScene = () =>
  use(Pass, { lights: true, oit: true, children: use(Body, {}) });

const App = () => {
  useDeviceContext();
  const [mode, setMode] = useState("plain");
  probe.setMode = setMode;
  probe.mounted = true;
  return use(OrbitCamera, {
    radius: extent * 1.6,
    target: bounds.center,
    children: mode === "post"
      ? use(PostScene, {})
      : mode === "alpha"
      ? use(AlphaScene, {})
      : use(PlainScene, {}),
  });
};

render(use(WebGPU, {
  fallback: (e) => {
    probe.errors.push(String(e));
    return null;
  },
  children: use(AutoCanvas, {
    selector: "#stage",
    samples: 1,
    backgroundColor: [0, 0, 0, 1],
    children: use(App, {}),
  }),
}));
