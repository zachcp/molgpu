import { React, render, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
} from "@use-gpu/workbench";
import { Spacefill, Structure, Tube } from "@molgpu/viewer";
import { annotation, COLOR } from "@molgpu/fields";
// Test diagnostics only; scene composition below uses public molecular entries.
import {
  enableInstrumentation,
  snapshotCounters,
} from "../../../packages/viewer/src/internal/instrumentation.ts";
enableInstrumentation();
import { data, fixture, windows } from "./fixture.ts";

export const probe = {
  errors: [] as string[],
  selected: 0,
  category: 0,
  updates: 0,
  get positionUploadBytes() {
    return snapshotCounters().detail["uploadBytes:structure:positions"] ?? 0;
  },
  get geometryBuilds() {
    return snapshotCounters().geometryBuilds;
  },
  fence: null as (() => Promise<void>) | null,
  mounted: false,
};
declare global {
  var __distribution: typeof probe;
}
globalThis.__distribution = probe;
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  probe.fence = () => device.queue.onSubmittedWorkDone();
  device.addEventListener(
    "uncapturederror",
    (event) => probe.errors.push(event.error.message),
  );
  return device;
};
const $ = (id: string) => document.getElementById(id)!;
const allWindows = windows(data);
const windowSelect = $("window") as HTMLSelectElement;
allWindows.forEach((rows, i) =>
  windowSelect.add(
    new Option(`A ${rows[0] + 1}–${rows.at(-1)! + 1}`, String(i)),
  )
);
let selected = 0;
let category = 0;
let update: (row: number) => void = () => {};
let hide: () => void = () => {};
function colors(row: number) {
  return annotation(
    "atom",
    COLOR,
    Float32Array.from(fixture.native.flatMap((aa, i) => {
      if (i === row) return [1, 0.8, 0.2, 1];
      if (fixture.missing[i]) return [0.45, 0.45, 0.45, 1];
      const p = fixture
        .values[i * fixture.alphabet.length + fixture.alphabet.indexOf(aa)];
      return [0.2 + 0.8 * p, 0.35 + 0.2 * p, 0.85 * (1 - p), 1];
    })),
  );
}
function inspect(row: number, letter: number) {
  selected = row;
  category = letter;
  probe.selected = row;
  probe.category = letter;
  probe.updates++;
  update(row);
  const residues = data.topology.residues;
  const chain = data.topology.chains.authId[residues.chain[row]];
  const value = fixture.values[row * fixture.alphabet.length + letter];
  $("detail").textContent = `${chain}:${residues.authSeq[row]}${
    residues.insertionCode[row]
  } (${fixture.native[row]}) → ${fixture.alphabet[letter]}: ${
    fixture.missing[row]
      ? "missing, no distribution supplied"
      : `${value.toFixed(6)} probability; sum = 1 (authored fixture)`
  }`;
  drawMatrix();
}
function drawMatrix() {
  const chain = ($("chain") as HTMLSelectElement).value;
  const windowId = windowSelect.value;
  const permitted = windowId === "all" ? null : allWindows[Number(windowId)];
  const rows = fixture.native.map((_, i) => i).filter((i) =>
    (chain === "all" ||
      data.topology.chains.authId[data.topology.residues.chain[i]] === chain) &&
    (!permitted || permitted.includes(i))
  );
  const table = document.createElement("table");
  const header = table.insertRow();
  ["Residue", ...fixture.alphabet].forEach((name) => {
    const cell = document.createElement("th");
    cell.textContent = name;
    header.append(cell);
  });
  for (const row of rows) {
    const tr = table.insertRow();
    const r = data.topology.residues;
    tr.insertCell().textContent = `${
      data.topology.chains.authId[r.chain[row]]
    }:${r.authSeq[row]}${r.insertionCode[row]} ${fixture.native[row]}`;
    fixture.alphabet.forEach((letter, index) => {
      const button = document.createElement("button");
      const value = fixture.values[row * fixture.alphabet.length + index];
      button.textContent = fixture.missing[row] ? "—" : value.toFixed(2);
      button.dataset.row = String(row);
      button.dataset.category = letter;
      button.setAttribute(
        "aria-label",
        `${tr.cells[0].textContent} ${letter} ${
          fixture.missing[row] ? "missing" : value.toFixed(6)
        }`,
      );
      button.setAttribute(
        "aria-pressed",
        String(row === selected && index === category),
      );
      button.style.background = fixture.missing[row]
        ? "#364353"
        : `rgb(${30 + value * 200}, ${45 + value * 65}, ${70 - value * 20})`;
      button.onclick = () => inspect(row, index);
      tr.insertCell().append(button);
    });
  }
  $("matrix").replaceChildren(table);
}
$("chain").onchange = drawMatrix;
windowSelect.onchange = drawMatrix;
$("unmount").onclick = () => hide();
const Scene = () => {
  const [row, setRow] = useState(0);
  const [visible, setVisible] = useState(true);
  update = setRow;
  hide = () => setVisible(false);
  probe.mounted = visible;
  return visible
    ? (
      <Structure data={data}>
        <Tube color={colors(row)} />
        <Spacefill color={colors(row)} scale={0.45} />
      </Structure>
    )
    : null;
};
render(
  <WebGPU fallback={null}>
    <AutoCanvas selector="#root">
      <OrbitCamera radius={45} target={[2, -2, 0]}>
        <Pass lights>
          <AmbientLight intensity={0.7} />
          <DirectionalLight direction={[-1, -2, -3]} />
          <Scene />
        </Pass>
      </OrbitCamera>
    </AutoCanvas>
  </WebGPU>,
);
inspect(0, 0);
