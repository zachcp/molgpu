/** @jsx LiveReact.createElement */
/**
 * ProteinMPNN on the GPU. @molgpu/nn runs the published v_48_020 checkpoint as
 * WGSL compute on the same GPUDevice that draws the structure. Hover a residue
 * to see its amino-acid distribution twice: from the backbone alone
 * (structure-only) and given every other native residue (conditional). The
 * strips below are drawn straight from the model's GPU buffers: both
 * probability matrices, each encoder layer's node embeddings, and any weight
 * matrix in the checkpoint.
 */
import {
  type LC,
  React as LiveReact,
  render,
  unmount,
  use,
  useMemo,
  useResource,
  useState,
} from "@use-gpu/live";
import { AutoCanvas } from "@use-gpu/webgpu";
import { Pass } from "@use-gpu/workbench";
import { annotation, COLOR } from "@molgpu/fields";
import { where } from "@molgpu/select";
import type { StructureData } from "@molgpu/table";
import {
  PROTEIN_MPNN_ALPHABET,
  PROTEIN_MPNN_ATOM_PAIRS,
  type ProteinMpnnStep,
} from "@molgpu/nn";
import {
  PickingProvider,
  Spacefill,
  Structure,
  usePicking,
} from "@molgpu/viewer";
import weightsUrl from "../../../packages/nn/test/fixtures/proteinmpnn_v_48_020.safetensors?url";
import gfpUrl from "../../../packages/io/test/fixtures/1ema.bcif?url";
import crambinUrl from "../../../packages/io/test/fixtures/1crn.bcif?url";
import complexUrl from "../../../packages/io/test/fixtures/1a4y.bcif?url";
import { cameraFor, loadStructure } from "../demos/data.ts";
import { OrbitControls, pageDevice, SharedWebGPU } from "../demos/viewer.tsx";
import type { Experiment } from "../pages/experiments.tsx";
import { Heatmap } from "./mpnn/heatmap.ts";
import { Weights3D } from "./mpnn/weights3d.ts";
import { type MpnnRun, runProteinMpnn } from "./mpnn/run.ts";
import { ForwardPlayer } from "./mpnn/forward.ts";
import { edgeFeaturesOf, neighborsOf } from "./mpnn/flow.ts";
import { type FlowColumn, FlowPanel } from "./mpnn/flow-panel.ts";

const STRUCTURES = [
  { id: "1ema", title: "GFP (1EMA)", url: gfpUrl },
  { id: "1crn", title: "Crambin (1CRN)", url: crambinUrl },
  { id: "1a4y", title: "RNase inhibitor–angiogenin (1A4Y)", url: complexUrl },
];
const LETTERS = PROTEIN_MPNN_ALPHABET.length;
const OTHER = [0.32, 0.34, 0.38, 1];
const HOVER = [1, 0.92, 0.3, 1] as const;

type Metric =
  | "conditional"
  | "structure"
  | "certainty"
  | "activation"
  | "neighbors";
const METRICS: Record<Metric, string> = {
  conditional: "P(native | sequence)",
  structure: "P(native | backbone)",
  certainty: "Certainty (1 − entropy)",
  activation: "Forward-pass step (|activation|)",
  neighbors: "Neighbour graph of hovered residue",
};

/** Which part of the model the page walks through. */
type Mode = "full" | "encoder" | "sequence";
const MODES: Record<Mode, string> = {
  full: "Full forward pass",
  encoder: "Encoder only (backbone)",
  sequence: "Sequence → P(aa)",
};
const MODE_STAGES: Record<Mode, readonly ProteinMpnnStep["stage"][]> = {
  full: ["features", "encoder", "sequence", "decoder", "output"],
  encoder: ["features", "encoder"],
  sequence: ["sequence", "decoder", "output"],
};
const BACKBONE = new Set(["N", "CA", "C", "O"]);

const STAGE_TITLES = {
  features: "Edge features",
  encoder: "Encoder",
  sequence: "Sequence",
  decoder: "Decoder",
  output: "Output",
} as const;

/** Hovered position, colour metric and forward-pass step, shared by the scene and the DOM. */
class Store {
  hovered = -1;
  metric: Metric = "conditional";
  mode: Mode = "full";
  step = 0;
  version = 0;
  #listeners = new Set<() => void>();
  update(
    patch: Partial<Pick<Store, "hovered" | "metric" | "mode" | "step">>,
  ): void {
    if (
      (patch.hovered ?? this.hovered) === this.hovered &&
      (patch.metric ?? this.metric) === this.metric &&
      (patch.mode ?? this.mode) === this.mode &&
      (patch.step ?? this.step) === this.step
    ) return;
    Object.assign(this, patch);
    this.version++;
    for (const listener of this.#listeners) listener();
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** Red (0) through sand (0.5) to blue (1). */
const ramp = (t: number): number[] => {
  const x = Math.min(1, Math.max(0, t));
  const [a, b] = x < 0.5
    ? [[0.86, 0.24, 0.22], [0.93, 0.83, 0.5]]
    : [[0.93, 0.83, 0.5], [0.27, 0.6, 0.93]];
  const s = x < 0.5 ? x * 2 : x * 2 - 1;
  return [...a.map((v, i) => v + (b[i] - v) * s), 1];
};

const probabilities = (logProbs: Float32Array, i: number) =>
  Array.from(logProbs.subarray(i * LETTERS, i * LETTERS + LETTERS), Math.exp);

/** Per-residue L2 norm of a trace step's values, divided by the largest. */
const norms = new WeakMap<Float32Array, Float32Array>();
const stepNorms = (run: MpnnRun, step: number) => {
  const values = run.traceValues[step];
  let out = norms.get(values);
  if (!out) {
    const l = run.input.sequence.length, c = values.length / l;
    out = new Float32Array(l);
    for (let i = 0; i < l; i++) {
      let sum = 0;
      for (let j = 0; j < c; j++) sum += values[i * c + j] ** 2;
      out[i] = Math.sqrt(sum);
    }
    const max = Math.max(...out) || 1;
    for (let i = 0; i < l; i++) out[i] /= max;
    norms.set(values, out);
  }
  return out;
};

/** The metric of model position i, in [0, 1]. */
const metricValue = (
  run: MpnnRun,
  metric: Metric,
  i: number,
  step: number,
) => {
  if (metric === "activation") return stepNorms(run, step)[i];
  const native = run.input.sequence[i];
  if (metric === "conditional") {
    return Math.exp(run.conditional.logProbs[i * LETTERS + native]);
  }
  if (metric === "structure") {
    return Math.exp(run.structureOnly.logProbs[i * LETTERS + native]);
  }
  const entropy = probabilities(run.structureOnly.logProbs, i)
    .reduce((h, p) => p > 0 ? h - p * Math.log(p) : h, 0);
  return 1 - entropy / Math.log(LETTERS);
};

const atomColors = (
  data: StructureData,
  run: MpnnRun,
  metric: Metric,
  step: number,
  hovered: number,
) => {
  const { atoms } = data.topology;
  const colors = new Float32Array(atoms.count * 4);
  const cache = new Map<number, number[]>();
  if (metric === "neighbors") {
    // Nearest neighbours blue through sand to red at the K-th; others grey.
    const { k } = run.encoding.graph;
    const rank = new Map(
      hovered < 0 ? [] : neighborsOf(run.input, run.encoding.graph, hovered)
        .map((n) => [n.position, n.rank]),
    );
    for (let atom = 0; atom < atoms.count; atom++) {
      const r = rank.get(run.position[atoms.residue[atom]]);
      colors.set(r === undefined ? OTHER : ramp(1 - r / k), 4 * atom);
    }
    return colors;
  }
  for (let atom = 0; atom < atoms.count; atom++) {
    const i = run.position[atoms.residue[atom]];
    let color = OTHER;
    if (i >= 0) {
      color = cache.get(i) ?? ramp(metricValue(run, metric, i, step));
      cache.set(i, color);
    }
    colors.set(color, 4 * atom);
  }
  return colors;
};

const HoverListener: LC<{ data: StructureData; run: MpnnRun; store: Store }> = (
  { data, run, store },
) => {
  usePicking({
    onHover: (hit) => {
      if (!hit) return;
      const i = run.position[data.topology.atoms.residue[hit.atom]];
      if (i >= 0) store.update({ hovered: i });
    },
  });
  return null;
};

const Stage: LC<{
  host: HTMLElement;
  viewport: string;
  data: StructureData;
  run: MpnnRun;
  store: Store;
}> = ({ host, viewport, data, run, store }) => {
  const [, setVersion] = useState(store.version);
  useResource(
    (dispose) => dispose(store.subscribe(() => setVersion(store.version))),
    [store],
  );
  const { metric, hovered, mode } = store;
  const step = metric === "activation" ? store.step : -1;
  const center = metric === "neighbors" ? hovered : -1;
  const color = useMemo(
    () =>
      annotation(
        "atom",
        COLOR,
        atomColors(data, run, metric, step, center),
      ),
    [data, run, metric, step, center],
  );
  // The encoder sees only N, CA, C and O, so encoder mode shows only those.
  const backboneOnly = mode === "encoder";
  const backbone = useMemo(
    () =>
      where(
        "atom",
        "mpnn backbone",
        (d, a) => BACKBONE.has(d.topology.atoms.name[a]),
      ),
    [],
  );
  const highlight = useMemo(() => {
    if (hovered < 0) return null;
    const row = run.input.residues[hovered];
    return backboneOnly
      ? where(
        "atom",
        `mpnn backbone ${row}`,
        (d, a) =>
          d.topology.atoms.residue[a] === row &&
          BACKBONE.has(d.topology.atoms.name[a]),
      )
      : where("residue", `mpnn residue ${row}`, (_, r) => r === row);
  }, [run, hovered, backboneOnly]);
  const camera = useMemo(() => cameraFor(data, 1.5), [data]);
  useResource(() => {
    host.dataset.webgpu = "ready";
  }, [host]);
  return use(OrbitControls, {
    host: viewport,
    target: camera.target,
    radius: camera.radius,
    bearing: 0.6,
    pitch: 0.3,
    children: (
      <Pass picking>
        <Structure data={data}>
          <PickingProvider>
            <Spacefill
              color={color}
              select={backboneOnly ? backbone : undefined}
              pickable
            />
            {highlight
              ? <Spacefill select={highlight} color={HOVER} scale={1.06} />
              : null}
            <HoverListener data={data} run={run} store={store} />
          </PickingProvider>
        </Structure>
      </Pass>
    ),
  });
};

/** Flow columns the given trace step is computing. */
const flowKeys = (step: ProteinMpnnStep): string[] => {
  switch (step.stage) {
    case "features":
      return step.name === "W_e → h_E" || step.name.startsWith("edge ")
        ? ["h_E"]
        : ["rbf"];
    case "encoder":
      return [`enc${step.layer}`, ...(step.layer === 2 ? ["ctx"] : [])];
    case "sequence":
      return ["onehot", "W_s", "h_S"];
    case "decoder":
      return [`dec${step.layer}`];
    case "output":
      return ["p"];
  }
};

const traceStep = (
  run: MpnnRun,
  stage: ProteinMpnnStep["stage"],
  layer: number,
  name: string,
) => {
  const step = run.trace.steps.find((s) =>
    s.stage === stage && s.layer === layer && s.name === name
  );
  if (!step) throw new Error(`trace has no ${stage} ${layer} ${name}`);
  return step;
};

const residueRows = (
  run: MpnnRun,
  step: ProteinMpnnStep,
  key: string,
  title: string,
  op: string,
  width = 1.4,
): FlowColumn => ({
  key,
  title,
  note: `[L × ${step.values.shape[1]}]`,
  op,
  rows: step.values.shape[0],
  cols: step.values.shape[1],
  palette: "diverging",
  scale: run.traceScales[step.index],
  buffer: step.values.buffer,
  residueRows: true,
  width,
});

/** Backbone in, structural embeddings out: what the encoder sees and makes. */
function encoderColumns(data: StructureData, run: MpnnRun): FlowColumn[] {
  const { graph } = run.encoding;
  const { residues } = data.topology;
  const name = (i: number) => {
    const row = run.input.residues[i];
    return `${residues.comp[row]} ${residues.authSeq[row]}`;
  };
  return [
    {
      key: "rbf",
      title: "Neighbours of the hovered residue",
      note: `K = ${graph.k} nearest by CA · 25 atom pairs × 16 distance bins`,
      rows: graph.k,
      cols: graph.rbf.length / (graph.length * graph.k),
      palette: "magnitude",
      scale: 1,
      values: (i) => edgeFeaturesOf(graph, i),
      rowLabels: (i) =>
        neighborsOf(run.input, graph, i).map((n) =>
          `${name(n.position)} ${n.distance.toFixed(1)}Å`
        ),
      colLabels: PROTEIN_MPNN_ATOM_PAIRS,
      width: 3.2,
    },
    residueRows(
      run,
      traceStep(run, "features", -1, "W_e → h_E"),
      "h_E",
      "Edge embedding h_E",
      "+ chain offset · W_e",
      1.5,
    ),
    ...[0, 1, 2].map((layer) =>
      residueRows(
        run,
        traceStep(run, "encoder", layer, "norm2 → h_V"),
        `enc${layer}`,
        `Encoder ${layer + 1} h_V`,
        `message passing ${layer + 1}`,
        1.5,
      )
    ),
  ];
}

/** Native sequence in, P(aa) out: the sequence becoming a matrix, then the decoder. */
function sequenceColumns(run: MpnnRun): FlowColumn[] {
  const l = run.input.sequence.length;
  const letters = [...PROTEIN_MPNN_ALPHABET];
  const ws = run.matrices.find((m) => m.name === "W_s.weight")!;
  return [
    {
      key: "onehot",
      title: "Native sequence",
      note: `one-hot [L × 21]`,
      rows: l,
      cols: letters.length,
      palette: "magnitude",
      scale: 1,
      buffer: run.oneHot.buffer,
      rowLabels: Array.from(run.input.sequence, (a) => letters[a]),
      colLabels: letters,
      residueRows: true,
      width: 1.1,
    },
    {
      key: "W_s",
      title: "W_s: one learned row per amino acid",
      note: "[21 × 128] · hovered residue's letter lit",
      op: "×",
      rows: letters.length,
      cols: ws.tensor.shape[1],
      palette: "diverging",
      scale: ws.scale,
      buffer: ws.tensor.buffer,
      rowLabels: letters,
      highlight: (i) => run.input.sequence[i],
      width: 1.8,
    },
    residueRows(
      run,
      traceStep(run, "sequence", -1, "sequence embedding W_s[s]"),
      "h_S",
      "Sequence embedding h_S",
      "=",
      1.5,
    ),
    residueRows(
      run,
      traceStep(run, "encoder", 2, "norm2 → h_V"),
      "ctx",
      "Structure h_V (encoder)",
      "with backbone",
      1.3,
    ),
    ...[0, 1, 2].map((layer) =>
      residueRows(
        run,
        traceStep(run, "decoder", layer, "norm2 → h_V"),
        `dec${layer}`,
        `Decoder ${layer + 1} h_V`,
        `sees neighbours' h_S`,
      )
    ),
    {
      key: "p",
      title: "P(aa | backbone, rest)",
      note: "[L × 21]",
      op: "W_out · softmax",
      rows: l,
      cols: letters.length,
      palette: "probability",
      scale: 2,
      buffer: run.conditional.tensor.buffer,
      colLabels: letters,
      residueRows: true,
      width: 1.1,
    },
  ];
}

const STYLE = `
  .experiment-canvas:has(.mpnn-layout) { height: auto; overflow: visible; background: none; touch-action: auto; }
  .mpnn-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: .75rem; color: #dbe4f3; font-size: .85rem; }
  .mpnn-viewport { position: relative; height: clamp(380px, 58vh, 680px); border-radius: 12px; overflow: hidden; background: #02040a; touch-action: none; }
  .mpnn-viewport canvas { width: 100%; height: 100%; display: block; }
  .mpnn-side, .mpnn-maps { background: #0a1220; border: 1px solid #1d2a3f; border-radius: 12px; padding: .7rem .8rem; }
  .mpnn-side label, .mpnn-maps label { display: flex; gap: .5rem; align-items: center; justify-content: space-between; margin-bottom: .3rem; }
  .mpnn-side select { flex: 1; min-width: 0; }
  .mpnn-layout select { font: inherit; color: inherit; background: #15213a; border: 1px solid #33476a; border-radius: 4px; padding: .15rem .3rem; max-width: 100%; }
  .mpnn-stats { color: #93a4bf; margin: .4rem 0; line-height: 1.4; }
  .mpnn-residue { font-size: 1.05rem; font-weight: 600; margin: .5rem 0 .2rem; }
  .mpnn-legend { display: flex; gap: .8rem; color: #93a4bf; margin-bottom: .25rem; }
  .mpnn-legend i { display: inline-block; width: .7rem; height: .7rem; border-radius: 2px; margin-right: .25rem; vertical-align: -1px; }
  .mpnn-bars { display: grid; grid-template-columns: 1.1rem 1fr 2.6rem; gap: 1px .35rem; align-items: center; font-variant-numeric: tabular-nums; }
  .mpnn-bars b { font-weight: 500; text-align: center; }
  .mpnn-bars b.native { background: #f5d74c; color: #111; border-radius: 3px; }
  .mpnn-bar { position: relative; height: 13px; }
  .mpnn-bar span { position: absolute; left: 0; height: 6px; border-radius: 2px; }
  .mpnn-bar .s { top: 0; background: #4cc3b5; }
  .mpnn-bar .c { bottom: 0; background: #f08a4b; }
  .mpnn-bars small { color: #93a4bf; text-align: right; }
  .mpnn-maps { grid-column: 1 / -1; display: grid; gap: .55rem; }
  .mpnn-map p { margin: 0 0 .2rem; color: #93a4bf; }
  .mpnn-map p strong { color: #dbe4f3; font-weight: 600; }
  .mpnn-map canvas { display: block; width: 100%; height: 72px; border-radius: 4px; cursor: crosshair; }
  .mpnn-strip { display: grid; grid-template-columns: .9rem 1fr; gap: .25rem; }
  .mpnn-strip > span { height: 147px; display: grid; grid-template-rows: repeat(21, 1fr); align-items: center; font-size: 6.5px; line-height: 1; font-style: normal; color: #93a4bf; text-align: center; }\n  .mpnn-strip i { font-style: normal; }
  .mpnn-map canvas.letters { height: 147px; }
  .mpnn-map canvas.tall { height: 150px; }
  .mpnn-map canvas.weight { height: 220px; cursor: default; }
  .mpnn-3d { position: relative; }
  .mpnn-map canvas.weights3d { height: 440px; cursor: grab; touch-action: none; }
  .mpnn-stage { position: absolute; transform: translate(-50%, -100%); pointer-events: none; padding: .05rem .4rem; border-radius: 4px; background: #050a16bb; color: #9fe3d8; font-size: .72rem; font-weight: 600; white-space: nowrap; }
  .mpnn-tip { z-index: 1; position: absolute; pointer-events: none; padding: .2rem .45rem; border-radius: 4px; background: #050a16ee; border: 1px solid #33476a; font-size: .75rem; white-space: nowrap; }
  .mpnn-3d-controls { display: flex; gap: .6rem; align-items: center; }
  .mpnn-layout .mpnn-3d-controls button { position: static; padding: .15rem .7rem; border: 1px solid #33476a; border-radius: 4px; background: #15213a; color: inherit; font: inherit; cursor: pointer; }
  .mpnn-forward { display: grid; grid-template-columns: auto auto auto 1fr; gap: .4rem; align-items: center; margin: .45rem 0 .3rem; }
  .mpnn-forward input { width: 100%; }
  .mpnn-layout .mpnn-forward button { position: static; padding: .15rem .6rem; border: 1px solid #33476a; border-radius: 4px; background: #15213a; color: inherit; font: inherit; cursor: pointer; }
  .mpnn-pipeline { display: flex; flex-wrap: wrap; gap: 2px; margin: .2rem 0 .35rem; }
  .mpnn-pipeline i { flex: 1 0 6px; height: 8px; border-radius: 2px; background: #1d2a3f; cursor: pointer; }
  .mpnn-pipeline i[data-stage=features] { background: #2b4560; }
  .mpnn-pipeline i[data-stage=encoder] { background: #2b5a55; }
  .mpnn-pipeline i[data-stage=sequence] { background: #6a5a2a; }
  .mpnn-pipeline i[data-stage=decoder] { background: #553a62; }
  .mpnn-pipeline i[data-stage=output] { background: #6a3a2a; }
  .mpnn-pipeline i.done { filter: brightness(1.6); }
  .mpnn-pipeline i.current { background: #f5d74c; }
  .mpnn-step { margin: 0 0 .25rem; color: #dbe4f3; }
  .mpnn-step small { color: #93a4bf; }
  .mpnn-flows { display: grid; gap: .7rem; }
  .mpnn-flow-title { margin: 0 0 .3rem; color: #93a4bf; }
  .mpnn-flow-title strong { color: #dbe4f3; }
  .mpnn-flow-row { display: flex; align-items: stretch; gap: .25rem; }
  .mpnn-flow-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; border: 1px solid transparent; border-radius: 6px; padding: 2px; transition: border-color .2s, background .2s; }
  .mpnn-flow-col.active { border-color: #f5d74c; background: #f5d74c14; }
  .mpnn-flow-col p { margin: 0 0 .15rem; height: 4.6em; overflow: hidden; line-height: 1.15; font-size: .72rem; }
  .mpnn-flow-col p strong { display: block; color: #dbe4f3; }
  .mpnn-flow-col p small { color: #93a4bf; font-size: .66rem; }
  .mpnn-flow-cols { display: flex; height: 2.4em; margin-left: var(--gutter, 0); }
  .mpnn-flow-cols i { flex: 1; min-width: 0; overflow: hidden; font-style: normal; font-size: 6.5px; color: #93a4bf; writing-mode: vertical-rl; transform: rotate(180deg); text-align: left; }
  .mpnn-flow-body { display: flex; gap: 2px; height: var(--flow-h, 320px); }
  .mpnn-flow-body canvas { flex: 1; min-width: 0; height: 100%; display: block; border-radius: 3px; }
  .mpnn-flow-body canvas.residues { cursor: crosshair; }
  .mpnn-flow-gutter { display: grid; width: 4.6rem; flex: none; align-items: center; font-size: clamp(0px, calc(var(--row-h, 8px) * .85), 9px); line-height: 1; color: #93a4bf; overflow: hidden; }
  .mpnn-flow-gutter i { font-style: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
  .mpnn-flow-col:has(.mpnn-flow-gutter) .mpnn-flow-cols { --gutter: calc(4.6rem + 2px); }
  .mpnn-flow-col[data-column=onehot] .mpnn-flow-gutter { width: .9rem; text-align: center; }
  .mpnn-flow-col[data-column=onehot]:has(.mpnn-flow-gutter) .mpnn-flow-cols { --gutter: calc(.9rem + 2px); }
  .mpnn-flow-col[data-column=W_s] .mpnn-flow-gutter { width: .9rem; font-size: 9px; }
  .mpnn-flow-col[data-column=W_s]:has(.mpnn-flow-gutter) .mpnn-flow-cols { --gutter: calc(.9rem + 2px); }
  .mpnn-flow-op { flex: none; width: 2.6rem; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #9fe3d8; font-size: .62rem; text-align: center; line-height: 1.1; }
  .mpnn-flow-op b { font-size: 1.3rem; color: #f5d74c; }
  @media (max-width: 760px) { .mpnn-layout { grid-template-columns: 1fr; } }
`;

const SIDE = `
  <label>Structure <select data-structure aria-label="Structure"></select></label>
  <label>View <select data-mode-picker aria-label="Model view">${
  Object.entries(MODES).map(([value, label]) =>
    `<option value="${value}">${label}</option>`
  ).join("")
}</select></label>
  <label>Colour <select data-metric aria-label="Colour metric">${
  Object.entries(METRICS).map(([value, label]) =>
    `<option value="${value}">${label}</option>`
  ).join("")
}</select></label>
  <p class="mpnn-stats" data-stats>Loading…</p>
  <div data-residue><p class="mpnn-stats">Hover a residue.</p></div>`;

const LETTER_GUTTER = `<span aria-hidden="true">${
  [...PROTEIN_MPNN_ALPHABET].map((letter) => `<i>${letter}</i>`).join("")
}</span>`;

const MAPS = `
  <div class="mpnn-map"><div class="mpnn-forward"><button type="button" data-prev aria-label="Previous step">◀</button><button type="button" data-play>Play forward pass</button><button type="button" data-next aria-label="Next step">▶</button><input type="range" data-step-slider min="0" max="0" value="0" aria-label="Forward-pass step"></div>
    <div class="mpnn-pipeline" data-pipeline></div>
    <p class="mpnn-step" data-step-label></p>
    <div class="mpnn-flows" data-flows></div></div>
  <div class="mpnn-map"><p><strong>Structure-only P(aa)</strong>: decoder output with no sequence · residues across, A–X down · hover to select</p><div class="mpnn-strip">${LETTER_GUTTER}<canvas class="letters" data-map="structure"></canvas></div></div>
  <div class="mpnn-map"><p><strong>Conditional P(aa)</strong>: each residue sees every other native residue</p><div class="mpnn-strip">${LETTER_GUTTER}<canvas class="letters" data-map="conditional"></canvas></div></div>
  <div class="mpnn-map"><label><span><strong>Encoder node embeddings h_V</strong>: residues across, 128 channels down</span><select data-layer aria-label="Encoder layer"><option value="0">layer 1</option><option value="1">layer 2</option><option value="2" selected>layer 3 (encoder output)</option></select></label><canvas class="tall" data-map="nodes"></canvas></div>
  <div class="mpnn-map"><label><span><strong>Weights in 3D</strong>: each matrix a slab coloured from its GPU buffer, in forward-pass order · width = inputs, height = outputs (PyTorch [out, in]) · drag to orbit · scroll to zoom · click a plane to show it below</span><span class="mpnn-3d-controls"><span>spacing <input type="range" data-gap min="0.1" max="3" step="0.05" value="0.6" aria-label="Stack spacing"></span><button type="button" data-stack>Unstack</button></span></label><div class="mpnn-3d"><canvas class="weights3d" data-map="weights3d"></canvas><div class="mpnn-tip" data-tip hidden></div></div>
    <p class="mpnn-stats">Current step's activations · residues across, channels down</p>
    <canvas class="tall" data-map="activation"></canvas></div>
  <div class="mpnn-map"><label><span><strong>Weights</strong>: the GPU buffers the forward pass reads · blue negative, orange positive</span><select data-weight aria-label="Weight matrix"></select></label><canvas class="weight" data-map="weight"></canvas></div>`;

/** The hovered residue's two distributions as paired bars. */
function residuePanel(data: StructureData, run: MpnnRun, i: number): string {
  const row = run.input.residues[i];
  const { residues, chains } = data.topology;
  const native = run.input.sequence[i];
  const s = probabilities(run.structureOnly.logProbs, i);
  const c = probabilities(run.conditional.logProbs, i);
  const top = (p: number[]) => PROTEIN_MPNN_ALPHABET[p.indexOf(Math.max(...p))];
  const bars = [...PROTEIN_MPNN_ALPHABET].map((letter, a) =>
    `<b class="${a === native ? "native" : ""}">${letter}</b>` +
    `<div class="mpnn-bar"><span class="s" style="width:${
      (100 * s[a]).toFixed(1)
    }%"></span><span class="c" style="width:${
      (100 * c[a]).toFixed(1)
    }%"></span></div>` +
    `<small>${(100 * c[a]).toFixed(0)}%</small>`
  ).join("");
  return `<p class="mpnn-residue">${residues.comp[row]} ${
    residues.authSeq[row]
  } · chain ${chains.authId[residues.chain[row]]}</p>
    <p class="mpnn-stats">Native ${
    PROTEIN_MPNN_ALPHABET[native]
  } · top backbone-only ${top(s)} · top conditional ${top(c)}</p>
    <div class="mpnn-legend"><span><i style="background:#4cc3b5"></i>backbone only</span><span><i style="background:#f08a4b"></i>conditional (%)</span></div>
    <div class="mpnn-bars" data-bars>${bars}</div>`;
}

export const experiment: Experiment = {
  title: "ProteinMPNN on the GPU",
  summary:
    "The ProteinMPNN sequence-design model runs as WGSL on the renderer's GPU. Hover a residue for its amino-acid distributions; strips show the probabilities, encoder embeddings and weights straight from GPU memory.",
  mount(host, params) {
    let live = true;
    let generation = 0;
    let fiber: ReturnType<typeof render> | null = null;
    let run: MpnnRun | null = null;
    let maps: Heatmap[] = [];
    let weightMap: Heatmap | null = null;
    let nodeMap: Heatmap | null = null;
    let weights3d: Weights3D | null = null;
    let activationMap: Heatmap | null = null;
    let player: ForwardPlayer | null = null;
    /** Trace step index of each player position, for the current mode. */
    let indices: number[] = [];
    let flows: FlowPanel[] = [];
    let frame = 0;
    const store = new Store();

    const layout = document.createElement("div");
    layout.className = "mpnn-layout";
    layout.innerHTML = `<style>${STYLE}</style>
      <div class="mpnn-viewport" id="${host.id}-viewport"></div>
      <div class="mpnn-side">${SIDE}</div>
      <div class="mpnn-maps">${MAPS}</div>`;
    host.append(layout);
    const $ = <T extends Element>(selector: string) =>
      layout.querySelector<T>(selector)!;
    const structurePicker = $<HTMLSelectElement>("[data-structure]");
    const metricPicker = $<HTMLSelectElement>("[data-metric]");
    const modePicker = $<HTMLSelectElement>("[data-mode-picker]");
    const flowHost = $<HTMLElement>("[data-flows]");
    const weightPicker = $<HTMLSelectElement>("[data-weight]");
    const layerPicker = $<HTMLSelectElement>("[data-layer]");
    const stats = $<HTMLElement>("[data-stats]");
    const stackButton = $<HTMLButtonElement>("[data-stack]");
    const gapInput = $<HTMLInputElement>("[data-gap]");
    stackButton.onclick = () => {
      if (!weights3d) return;
      stackButton.textContent = weights3d.toggle() === "stacked"
        ? "Unstack"
        : "Stack";
    };
    gapInput.oninput = () => weights3d?.setGap(Number(gapInput.value));
    const residue = $<HTMLElement>("[data-residue]");
    const playButton = $<HTMLButtonElement>("[data-play]");
    const stepInput = $<HTMLInputElement>("[data-step-slider]");
    const stepLabel = $<HTMLElement>("[data-step-label]");
    const pipeline = $<HTMLElement>("[data-pipeline]");
    const syncPlay = () =>
      playButton.textContent = player?.playing ? "Pause" : "Play forward pass";
    playButton.onclick = () => {
      if (!player) return;
      player.toggle();
      syncPlay();
      if (player.playing && !frame) {
        let last = performance.now();
        const loop = (now: number) => {
          player?.tick(now - last);
          last = now;
          frame = player?.playing ? requestAnimationFrame(loop) : 0;
          if (!frame) syncPlay();
        };
        frame = requestAnimationFrame(loop);
      }
    };
    $<HTMLButtonElement>("[data-prev]").onclick = () => player?.previous();
    $<HTMLButtonElement>("[data-next]").onclick = () => player?.next();
    stepInput.oninput = () => player?.seek(Number(stepInput.value));
    pipeline.onclick = (event) => {
      const index = (event.target as HTMLElement).dataset.index;
      if (index !== undefined) player?.seek(Number(index));
    };
    const setMetric = (metric: Metric) => {
      metricPicker.value = metric;
      store.update({ metric });
    };
    for (const { id, title } of STRUCTURES) {
      structurePicker.append(new Option(title, id));
    }
    structurePicker.value =
      STRUCTURES.some((s) => s.id === params.get("structure"))
        ? params.get("structure")!
        : STRUCTURES[0].id;
    const initialMode = params.get("mode");
    if (initialMode && initialMode in MODES) {
      modePicker.value = initialMode;
      if (initialMode === "encoder") setMetric("neighbors");
    }
    metricPicker.onchange = () =>
      store.update({ metric: metricPicker.value as Metric });

    let data: StructureData | null = null;
    const unsubscribe = store.subscribe(() => {
      if (!run || !data || store.hovered < 0) return;
      residue.innerHTML = residuePanel(data, run, store.hovered);
      host.dataset.hovered = String(store.hovered);
      for (const map of maps) map.highlight(store.hovered);
      nodeMap?.highlight(store.hovered);
      activationMap?.highlight(store.hovered);
      for (const flow of flows) flow.highlight(store.hovered);
    });

    const teardown = () => {
      if (fiber) unmount(fiber);
      fiber = null;
      cancelAnimationFrame(frame);
      frame = 0;
      player = null;
      syncPlay();
      for (const flow of flows) flow.destroy();
      flows = [];
      for (
        const map of [...maps, weightMap, nodeMap, activationMap, weights3d]
      ) {
        map?.destroy();
      }
      maps = [];
      weightMap =
        nodeMap =
        activationMap =
        weights3d =
          null;
      run?.runtime.destroy();
      run = null;
    };

    const showWeight = (device: GPUDevice, current: MpnnRun) => {
      weightMap?.destroy();
      const view = current.matrices[Number(weightPicker.value)];
      const [rows, cols] = view.tensor.shape;
      weightMap = new Heatmap(
        device,
        $("[data-map=weight]"),
        view.tensor.buffer,
        {
          rows,
          cols,
          palette: "diverging",
          scale: view.scale,
        },
      );
      weightMap.draw();
    };
    const showLayer = (device: GPUDevice, current: MpnnRun) => {
      nodeMap?.destroy();
      const nodes = current.encoding.layers[Number(layerPicker.value)];
      nodeMap = new Heatmap(device, $("[data-map=nodes]"), nodes.buffer, {
        rows: nodes.shape[0],
        cols: nodes.shape[1],
        palette: "diverging",
        scale: 3,
        transpose: true,
      });
      nodeMap.highlight(store.hovered);
      nodeMap.draw();
    };

    /** Show trace step i: its activations, the weights it reads, its place in the pass. */
    const showStep = (device: GPUDevice, current: MpnnRun, i: number) => {
      const step = current.trace.steps[i];
      const [l, c] = step.values.shape;
      activationMap?.destroy();
      activationMap = new Heatmap(
        device,
        $("[data-map=activation]"),
        step.values.buffer,
        {
          rows: l,
          cols: c,
          palette: "diverging",
          scale: current.traceScales[i],
          transpose: true,
        },
      );
      activationMap.highlight(store.hovered);
      activationMap.draw();
      weights3d?.focus(step.weights);
      const where = step.layer >= 0
        ? `${STAGE_TITLES[step.stage]} ${step.layer + 1}`
        : STAGE_TITLES[step.stage];
      const reads = step.weights.filter((w) => w.endsWith(".weight"))
        .map((w) => w.replace(/\.weight$/, ""));
      stepLabel.innerHTML = `<strong>${
        i + 1
      }/${current.trace.steps.length} · ${where} · ${step.name}</strong> <small>[${
        step.shape.join(" × ")
      }]${
        step.shape.length === 3 ? " shown as the mean over K neighbours" : ""
      } · residues across, ${c} channels down${
        reads.length ? ` · reads ${reads.join(", ")}` : " · no weights"
      }</small>`;
      const position = indices.indexOf(i);
      stepInput.value = String(position);
      pipeline.querySelectorAll("i").forEach((el, j) => {
        el.classList.toggle("current", j === position);
        el.classList.toggle("done", j < position);
      });
      for (const flow of flows) flow.activate(flowKeys(step));
      host.dataset.step = String(i);
      store.update({ step: i });
    };

    /** Rebuild the player and flow panels for the selected mode. */
    const setupMode = (
      device: GPUDevice,
      structure: StructureData,
      current: MpnnRun,
    ) => {
      const mode = modePicker.value as Mode;
      cancelAnimationFrame(frame);
      frame = 0;
      const steps = current.trace.steps;
      indices = steps.filter((s) => MODE_STAGES[mode].includes(s.stage))
        .map((s) => s.index);
      stepInput.max = String(indices.length - 1);
      pipeline.innerHTML = indices.map((t, j) => {
        const s = steps[t];
        return `<i data-index="${j}" data-stage="${s.stage}" title="${t + 1}. ${
          s.layer >= 0
            ? `${STAGE_TITLES[s.stage]} ${s.layer + 1}`
            : STAGE_TITLES[s.stage]
        }: ${s.name}"></i>`;
      }).join("");
      for (const flow of flows) flow.destroy();
      const l = current.input.sequence.length;
      const height = Math.min(480, Math.max(240, l * 8));
      flowHost.style.setProperty("--flow-h", `${height}px`);
      flowHost.style.setProperty("--row-h", `${height / l}px`);
      const hover = (i: number) => store.update({ hovered: i });
      flows = [];
      if (mode !== "sequence") {
        flows.push(
          new FlowPanel(
            device,
            flowHost,
            "<strong>Encoder: backbone in, structure embeddings out.</strong> Only N, CA, C and O coordinates enter; no amino acids. Each residue's K nearest neighbours become distance features, and three rounds of message passing turn them into a 128-number description per residue.",
            encoderColumns(structure, current),
            hover,
          ),
        );
      }
      if (mode !== "encoder") {
        flows.push(
          new FlowPanel(
            device,
            flowHost,
            "<strong>Decoder: sequence in, P(aa) out.</strong> Each letter selects its row of W_s, turning the sequence into an L × 128 matrix. The decoder combines it with the encoder's structure embeddings; each residue sees its neighbours' letters but not its own.",
            sequenceColumns(current),
            hover,
          ),
        );
      }
      for (const flow of flows) flow.highlight(Math.max(0, store.hovered));
      player = new ForwardPlayer(
        indices.length,
        (j) => showStep(device, current, indices[j]),
      );
      syncPlay();
      host.dataset.mode = mode;
      store.update({ mode });
      showStep(device, current, indices[0]);
    };

    // Hovering any residue-indexed strip selects that residue.
    const hoverStrip = (event: MouseEvent) => {
      const canvas = event.target as HTMLCanvasElement;
      const map = [...maps, nodeMap, activationMap].find((m) =>
        m?.canvas === canvas
      );
      const row = map?.rowAt(event) ?? -1;
      if (row >= 0) store.update({ hovered: row });
    };
    for (const name of ["structure", "conditional", "nodes", "activation"]) {
      $<HTMLCanvasElement>(`[data-map=${name}]`).addEventListener(
        "mousemove",
        hoverStrip,
      );
    }

    const load = () => {
      const request = ++generation;
      teardown();
      const entry = STRUCTURES.find((s) => s.id === structurePicker.value)!;
      host.dataset.mpnn = "loading";
      stats.textContent = `Loading ${entry.title} and ProteinMPNN weights…`;
      residue.innerHTML = `<p class="mpnn-stats">Hover a residue.</p>`;
      store.update({ hovered: -1 });
      void Promise.all([loadStructure(entry.url, entry.title), pageDevice()])
        .then(async ([structure, device]) => {
          if (!live || request !== generation) return;
          stats.textContent = "Running ProteinMPNN on the GPU…";
          const current = await runProteinMpnn(device, structure, weightsUrl);
          if (!live || request !== generation) {
            current.runtime.destroy();
            return;
          }
          run = current;
          data = structure;
          const l = current.input.sequence.length;
          stats.innerHTML =
            `${l} residues, K = ${current.encoding.graph.k} neighbours · ` +
            `v_48_020 weights (fp16) · GPU forward + readback ${
              current.milliseconds.toFixed(0)
            } ms<br>Backbone-only native recovery ${
              (100 * current.recovery).toFixed(1)
            }%`;
          host.dataset.mpnn = "ready";
          host.dataset.recovery = current.recovery.toFixed(3);
          maps = (["structure", "conditional"] as const).map((name) => {
            const decoded = name === "structure"
              ? current.structureOnly
              : current.conditional;
            const map = new Heatmap(
              device,
              $(`[data-map=${name}]`),
              decoded.tensor.buffer,
              {
                rows: l,
                cols: LETTERS,
                palette: "probability",
                scale: 2,
                transpose: true,
              },
            );
            map.draw();
            return map;
          });
          weightPicker.replaceChildren(
            ...current.matrices.map((m, i) => new Option(m.label, String(i))),
          );
          weightPicker.onchange = () => showWeight(device, current);
          layerPicker.onchange = () => showLayer(device, current);
          showWeight(device, current);
          showLayer(device, current);
          weights3d = new Weights3D(
            device,
            $("[data-map=weights3d]"),
            $("[data-tip]"),
            current.matrices,
            (index) => {
              weightPicker.value = String(index);
              showWeight(device, current);
            },
          );
          stackButton.textContent = "Unstack";
          weights3d.setGap(Number(gapInput.value));
          store.update({ hovered: 0 });
          modePicker.onchange = () => {
            const mode = modePicker.value as Mode;
            if (mode === "encoder") setMetric("neighbors");
            else if (store.metric === "neighbors") setMetric("conditional");
            setupMode(device, structure, current);
          };
          setupMode(device, structure, current);
          fiber = render(use(SharedWebGPU, {
            fallback: (error: unknown) => {
              host.dataset.webgpu = "error";
              stats.textContent = `WebGPU is unavailable: ${String(error)}`;
              return null;
            },
            children: use(AutoCanvas, {
              selector: `#${host.id}-viewport`,
              samples: 4,
              backgroundColor: [0.01, 0.015, 0.03, 1],
              children: use(Stage, {
                host,
                viewport: `#${host.id}-viewport`,
                data: structure,
                run: current,
                store,
              }),
            }),
          }));
        })
        .catch((error) => {
          if (!live || request !== generation) return;
          host.dataset.mpnn = "error";
          stats.textContent = String(error);
        });
    };
    structurePicker.onchange = load;
    load();
    return () => {
      live = false;
      unsubscribe();
      teardown();
      layout.remove();
    };
  },
};
