// Instrumented mount for the urn.5 derived-style-field invariant, for both a
// scalar (size) field and a colour field.
//
//  - scale changes must not re-upload the shared radii column (uniform write).
//  - colours come from a byElement field composed over the element column, so no
//    per-atom colour array is uploaded at all; swapping the palette rebuilds the
//    shader module but re-uploads no per-atom array.
//
// We count STORAGE buffer allocations (RawData columns) so either change shows
// zero new storage buffers after warm-up.
import { render, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import { attribute, categorical, colormap, curve } from "@molgpu/fields";
import { createCurve, createTimeline, sample } from "@molgpu/timeline";
import { ColumnSource } from "../src/rendering/column-source.ts";
import { WorldSpacePointLayer } from "../src/representations/world-space-points.ts";
import { useField } from "../src/field-binding/use-field.ts";
import { TimelineProvider, useTimelineTime } from "../src/timeline-context.ts";

const probe = globalThis.__probe = {
  storage: 0,
  storageBuffers: [],
  storageWrites: [],
  uniform: 0,
  errors: [],
  mounted: false,
};
const make = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  const buffer = make.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) {
    probe.storage++;
    probe.storageBuffers.push(buffer);
  }
  if (desc.usage & GPUBufferUsage.UNIFORM) probe.uniform++;
  return buffer;
};
const write = GPUQueue.prototype.writeBuffer;
GPUQueue.prototype.writeBuffer = function (buffer, ...args) {
  if (buffer.usage & GPUBufferUsage.STORAGE) {
    probe.storageWrites.push(buffer.label);
  }
  return write.call(this, buffer, ...args);
};
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener(
    "uncapturederror",
    (e) => probe.errors.push(e.error.message),
  );
  return device;
};

const N = 216;
const positions = new Float32Array(N * 3);
const radii = new Float32Array(N);
const elements = new Float32Array(N);
const ELS = [6, 7, 8, 16];
for (let i = 0; i < N; i++) {
  positions[i * 3] = (i % 18) - 9;
  positions[i * 3 + 1] = Math.floor(i / 18) - 6;
  positions[i * 3 + 2] = 0;
  radii[i] = 0.6 + (i % 5) * 0.12;
  elements[i] = ELS[i % 4];
}

// Two palettes: swapping between them changes colours via a new shader module,
// but must not re-upload the per-atom element column.
const PALETTES = [
  categorical(attribute("element"), {
    6: [0.8, 0.8, 0.85, 1],
    7: [0.35, 0.5, 0.92, 1],
    8: [0.9, 0.36, 0.33, 1],
    16: [0.95, 0.8, 0.3, 1],
  }, [0.5, 0.5, 0.5, 1]),
  categorical(attribute("element"), {
    6: [0.2, 0.7, 0.4, 1],
    7: [0.2, 0.7, 0.4, 1],
    8: [0.9, 0.2, 0.6, 1],
    16: [0.9, 0.2, 0.6, 1],
  }, [0.5, 0.5, 0.5, 1]),
  // Time-driven colour: a curve over the global t uniform ramps a gradient. The
  // t change must be a uniform write, not a per-atom re-upload.
  colormap(curve([[0, 0], [1, 1]]), [[0, [0.1, 0.2, 0.9, 1]], [1, [
    0.95,
    0.3,
    0.2,
    1,
  ]]]),
];

const beats = createTimeline([{ name: "start", time: 0 }, {
  name: "reveal",
  time: 1,
}, { name: "orbit", time: 2 }]);
const cameraRadius = createCurve([
  { time: beats.time("start"), value: 34, ease: "hold" },
  { time: beats.time("reveal"), value: 34 },
  { time: beats.time("orbit"), value: 20 },
]);
const cameraBearing = createCurve([
  { time: beats.time("start"), value: 0.6, ease: "hold" },
  { time: beats.time("reveal"), value: 0.6 },
  { time: beats.time("orbit"), value: 1.1 },
]);

const Points = ({ positions, radiusSource, elementSource, scale, palette }) => {
  const colors = useField(
    PALETTES[palette],
    { "attr:element": elementSource },
    { domain: "atom" },
  );
  return use(WorldSpacePointLayer, {
    positions,
    colors,
    radii: radiusSource,
    count: N,
    scale,
    shape: "circle",
    shaded: true,
  });
};

const Scene = ({ state }) => {
  const time = useTimelineTime();
  const radius = sample(cameraRadius, time);
  const bearing = sample(cameraBearing, time);
  probe.camera = { radius, bearing };
  return use(ColumnSource, {
    data: positions,
    format: "vec3<f32>",
    label: "positions",
    render: (pos) =>
      use(ColumnSource, {
        data: elements,
        format: "f32",
        label: "elements",
        render: (elem) =>
          use(ColumnSource, {
            data: radii,
            format: "f32",
            label: "radii",
            render: (radiusSource) =>
              use(OrbitCamera, {
                radius,
                bearing,
                pitch: 0.35,
                target: [0, 0, 0],
                children: use(Pass, {
                  lights: true,
                  children: [
                    use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
                    use(DirectionalLight, {
                      position: [1, 2, 1.5],
                      color: [1, 1, 1],
                      intensity: 1,
                    }),
                    use(Points, {
                      positions: pos,
                      radiusSource,
                      elementSource: elem,
                      scale: state.scale,
                      palette: state.palette,
                    }),
                  ],
                }),
              }),
          }),
      }),
  });
};

const App = () => {
  useDeviceContext();
  const [state, setState] = useState({ scale: 1, palette: 0, time: 0 });
  probe.setScale = (scale) => setState((s) => ({ ...s, scale }));
  probe.setPalette = (palette) => setState((s) => ({ ...s, palette }));
  probe.setTime = (time) => setState((s) => ({ ...s, time }));
  probe.mounted = true;
  return use(TimelineProvider, {
    time: state.time,
    children: use(Scene, { state }),
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
