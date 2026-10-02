// hj0.3 browser proof: a pickable <Spacefill> draws into the picking buffer;
// usePicking() resolves the atom under the cursor; and the click-to-seek recipe
// (map the picked atom to a beat, set the caller-owned TimelineProvider) moves
// the timeline. Three atoms in a row; the middle one (row 1) sits at the camera
// target, so the canvas centre picks atom 1.
import { render, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import { createStructure } from "@molgpu/table";
import { resolve, where } from "@molgpu/select";
import { byElement } from "@molgpu/fields";
import { createTimeline } from "@molgpu/timeline";
import {
  PickingProvider,
  Spacefill,
  Structure,
  TimelineProvider,
  usePicking,
} from "../src/index.ts";

const probe = globalThis.__probe = {
  errors: [],
  mounted: false,
  hover: null,
  pick: null,
  time: null,
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

const data = createStructure({
  positions: Float32Array.from([-4, 0, 0, 0, 0, 0, 4, 0, 0]),
  topology: {
    atoms: {
      count: 3,
      id: ["1", "2", "3"],
      name: ["C1", "C2", "C3"],
      altloc: ["", "", ""],
      residue: Uint32Array.of(0, 1, 2),
      element: new Uint8Array([6, 6, 6]),
      occupancy: new Float32Array([1, 1, 1]),
      bfactor: new Float32Array([5, 15, 25]),
      radius: new Float32Array([1.6, 1.6, 1.6]),
    },
    residues: {
      count: 3,
      chain: Uint32Array.of(0, 0, 0),
      labelSeq: Int32Array.of(1, 2, 3),
      authSeq: ["1", "2", "3"],
      insertionCode: ["", "", ""],
      comp: ["ALA", "ALA", "ALA"],
      polymer: ["protein", "protein", "protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.of(1),
      labelId: ["A"],
      authId: ["A"],
    },
    bonds: {
      count: 0,
      a: new Uint32Array(),
      b: new Uint32Array(),
      order: new Uint8Array(),
      source: [],
    },
    instances: {
      count: 1,
      chain: new Uint32Array(1),
      operatorId: ["1"],
      transform: Float64Array.of(
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
        0,
        0,
        0,
        1,
      ),
    },
  },
});

// ?assembly: the same atoms with a second copy 6 Å up (molgpu-sept-fch.3).
const assembled = createStructure({
  positions: data.positions,
  topology: {
    ...data.topology,
    instances: {
      count: 2,
      chain: Uint32Array.of(0, 0),
      operatorId: ["1", "2"],
      transform: Float64Array.from([
        ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 6, 0, 1],
      ]),
    },
  },
});
const shown = new URLSearchParams(location.search).has("assembly")
  ? assembled
  : data;

// One beat per atom row; clicking an atom seeks to its beat.
const timeline = createTimeline([{ name: "a0", time: 0 }, {
  name: "a1",
  time: 5,
}, { name: "a2", time: 10 }]);
const seek = (atom) =>
  timeline.beats[Math.min(atom, timeline.beats.length - 1)].time;

const Readout = () => {
  const { hover, pick } = usePicking({
    onPick: (hit) => {
      if (hit) probe.setTime(seek(hit.atom));
    },
  });
  probe.hover = hover
    ? {
      id: hover.id,
      atom: hover.atom,
      drawIndex: hover.drawIndex,
      operatorId: hover.operatorId ?? null,
    }
    : null;
  probe.pick = pick ? { id: pick.id, atom: pick.atom } : null;
  return null;
};

// `?select`: draw rows 1 and 2 only, coloured by a field. The middle atom is
// then drawn instance 0, so picking must map it back through the selection
// rows, and the GPU must read its position through the same rows.
const selectedProps = new URLSearchParams(location.search).has("select")
  ? {
    select: resolve(where("atom", "not first", (_, i) => i > 0), data),
    color: byElement(),
  }
  : {};

const App = () => {
  useDeviceContext();
  const [time, setTime] = useState(0);
  probe.setTime = setTime;
  probe.time = time;
  probe.mounted = true;
  return use(TimelineProvider, {
    time,
    children: use(OrbitCamera, {
      radius: 14,
      target: [0, 0, 0],
      bearing: 0,
      pitch: 0,
      children: use(Pass, {
        lights: true,
        picking: true,
        children: [
          use(AmbientLight, { intensity: 0.3 }),
          use(DirectionalLight, { direction: [-1, -2, -1.5], intensity: 1 }),
          use(Structure, {
            data: shown,
            children: use(Spacefill, {
              pickable: true,
              scale: 1,
              ...selectedProps,
            }),
          }),
          use(Readout, {}),
        ],
      }),
    }),
  });
};

render(use(WebGPU, {
  fallback: (e) => {
    probe.errors.push(String(e));
    return null;
  },
  children: use(PickingProvider, {
    children: use(AutoCanvas, {
      selector: "#stage",
      samples: 1,
      backgroundColor: [0, 0, 0, 1],
      children: use(App, {}),
    }),
  }),
}));
