// 0sj.6 browser proof: a real corpus structure (with a genuine helix)
// renders a ribbon, a color edit uploads no new geometry, and an empty
// selection renders nothing without error.
import { render, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import { resolve, where } from "@molgpu/select";
import {
  activeAtoms,
  coordinateBounds,
  dssp,
  withPositions,
} from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { GpuDssp, Ribbon, Structure, Transform } from "../src/index.ts";
import { WobbleCoordinates } from "./fixtures/wobble-coordinates.ts";
import {
  enableInstrumentation,
  snapshotCounters,
} from "../src/internal/instrumentation.ts";
import { useAttributeSnapshot } from "../src/advanced.ts";

enableInstrumentation();

const probe = globalThis.__probe = {
  storage: [],
  storageBuffers: [],
  storageWrites: [],
  errors: [],
  mounted: false,
  dsspStatus: null,
  dsspSnapshot: null,
  dsspRuns: 0,
  dsspCodes: null,
  counters: snapshotCounters,
};
const storageInfo = new WeakMap();
const make = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  const buffer = make.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) {
    const info = {
      id: probe.storage.length,
      capacity: desc.size,
      label: desc.label ?? "",
    };
    probe.storage.push(info);
    probe.storageBuffers.push(buffer);
    storageInfo.set(buffer, info);
  }
  return buffer;
};
const write = GPUQueue.prototype.writeBuffer;
GPUQueue.prototype.writeBuffer = function (
  buffer,
  offset,
  data,
  dataOffset,
  size,
) {
  if (buffer.usage & GPUBufferUsage.STORAGE) {
    probe.storageWrites.push({
      ...storageInfo.get(buffer),
      label: buffer.label,
      offset,
      bytes: size ?? data.byteLength,
    });
  }
  return write.call(this, buffer, offset, data, dataOffset, size);
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

const bytes = new Uint8Array(
  await (await fetch("/packages/io/test/fixtures/1crn.bcif")).arrayBuffer(),
);
const data = await structureFromBcif(bytes);
const nothing = resolve(where("atom", "none", () => false), data);
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
const wobblePositions = data.positions.slice();
for (let i = 0; i < wobblePositions.length; i += 3) {
  wobblePositions[i + 1] += Math.sin(0.7 + wobblePositions[i] * 0.4) * 0.8;
}
probe.expectedWobbleCodes = Array.from(
  dssp(withPositions(data, wobblePositions), { rows: activeAtoms(data) }),
);

const DsspSnapshotProbe = () => {
  const snapshot = useAttributeSnapshot("ssCode");
  probe.dsspSnapshot = snapshot && {
    generation: snapshot.generation,
    provenance: snapshot.data.attributes?.ssCode?.provenance,
  };
  probe.dsspCodes = snapshot?.data.attributes?.ssCode?.provenance === "gpu:dssp"
    ? Array.from(snapshot.data.attributes.ssCode.values)
    : null;
  return null;
};

// The edited state lives BELOW a stable <Pass>, as in a real app, so a style
// edit must repaint on its own (molgpu-sept-jrr).
const RibbonProbe = () => {
  const [mode, setMode] = useState("ribbon");
  const [color, setColor] = useState([0.85, 0.55, 0.35, 1]);
  const [shift, setShift] = useState(0);
  const [phase, setPhase] = useState(0.7);
  probe.setMode = setMode;
  probe.setColor = setColor;
  probe.setShift = setShift;
  probe.setPhase = setPhase;
  probe.mounted = true;
  const props = mode === "empty" ? { select: nothing, color } : { color };
  const ribbon = use(Ribbon, props);
  const gpu = use(GpuDssp, {
    onStatus: (status) => {
      probe.dsspStatus = status;
      probe.dsspRuns++;
    },
    children: [ribbon, use(DsspSnapshotProbe, {})],
  });
  return use(Structure, {
    data,
    children: mode === "gpu"
      ? use(Transform, {
        matrix: [
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          shift,
          0,
          0,
          1,
        ],
        children: gpu,
      })
      : mode === "wobble"
      ? use(WobbleCoordinates, { phase, children: gpu })
      : ribbon,
  });
};

const App = () => {
  useDeviceContext();
  return use(OrbitCamera, {
    radius: extent * 1.6,
    target: bounds.center,
    children: use(Pass, {
      lights: true,
      children: [
        use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
        use(DirectionalLight, {
          position: [1, 2, 1.5],
          color: [1, 1, 1],
          intensity: 1,
        }),
        use(RibbonProbe, {}),
      ],
    }),
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
