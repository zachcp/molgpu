// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
/** An illustrative string, not a force field or molecular dynamics model. */
import {
  keyed,
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
import type { StorageSource, StorageTarget } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";
import {
  Compute,
  ComputeBuffer,
  Kernel,
  LineLayer,
  Pass,
  useDerivedSource,
  useRawSource,
  useRenderContext,
  useShader,
  useShaderRef,
} from "@use-gpu/workbench";
import { Pick } from "@use-gpu/interact";
import { useAnimationFrame, useNoAnimationFrame } from "@use-gpu/frame";
import { wgsl } from "@use-gpu/shader/wgsl";
import { type StructureData, traceTable } from "@molgpu/table";
import { protein, resolve } from "@molgpu/select";
import { Structure } from "@molgpu/viewer";
import { useCoordinates } from "@molgpu/viewer/advanced";
import { cameraFor, loadStructure } from "../demos/data.ts";
import { structures } from "../demos/registry.ts";
import { OrbitControls, SharedWebGPU } from "../demos/viewer.tsx";
import type { Experiment } from "../pages/experiments.tsx";

const DURATION = 10;

// Evaluate each guide once, rather than repeating all string modes for every
// spline sample and every neighbour lookup made by the native line renderer.
const WAVE = wgsl`
@link fn getSize() -> vec3<u32>;
// elapsed seconds, pluck fraction, amplitude in Å
@link fn getPulse() -> vec4<f32>;
@link fn getAtom(i: u32) -> vec4<f32>;
@link fn getRow(i: u32) -> u32;
@link var<storage, read_write> output: array<vec4<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= getSize().x) { return; }
  let last = i32(getSize().x) - 1;
  let k = i32(id.x);
  let p = getAtom(getRow(u32(k))).xyz;
  let s = f32(k) / f32(last);
  let pulse = getPulse();
  if (k == 0 || k == last || pulse.z == 0.0) {
    output[id.x] = vec4<f32>(p, 1.0);
    return;
  }
  // Fixed-end string modes for a triangular initial displacement, released
  // from rest. Sequence distance is illustrative, not physical arc length.
  var wave = 0.0;
  for (var mode = 1u; mode <= 16u; mode++) {
    let n = f32(mode);
    wave += sin(n * 3.14159265 * pulse.y) * sin(n * 3.14159265 * s)
      * cos(n * 2.8 * pulse.x) / (n * n);
  }
  wave *= 2.0 / (9.8696044 * pulse.y * (1.0 - pulse.y));
  wave *= pulse.z * exp(-0.65 * pulse.x);
  let tangent = getAtom(getRow(u32(min(k + 1, last)))).xyz
    - getAtom(getRow(u32(max(k - 1, 0)))).xyz;
  // Stable transverse direction without normalizing a zero cross product.
  var normal = cross(tangent, vec3<f32>(0.0, 1.0, 0.0));
  if (dot(normal, normal) < 1e-6) { normal = vec3<f32>(1.0, 0.0, 0.0); }
  output[id.x] = vec4<f32>(p + normalize(normal) * wave, 1.0);
}
`;

const GUIDE = wgsl`
@link fn getAtom(i: u32) -> vec4<f32>;
@link fn getRow(i: u32) -> u32;
@export fn getGuide(i: u32) -> vec4<f32> { return getAtom(getRow(i)); }
`;

const STRING = wgsl`
@link fn getGuide(i: u32) -> vec4<f32>;
@link fn getCount() -> u32;
@link fn getSteps() -> u32;

fn point(j: i32) -> vec3<f32> {
  return getGuide(u32(clamp(j, 0, i32(getCount()) - 1))).xyz;
}

@export fn getPosition(i: u32) -> vec4<f32> {
  let steps = getSteps();
  let j = min(i / steps, getCount() - 2u);
  let t = f32(i - j * steps) / f32(steps);
  let p1 = point(i32(j)); let p2 = point(i32(j) + 1);
  var p0 = point(i32(j) - 1); var p3 = point(i32(j) + 2);
  if (j == 0u) { p0 = 2.0 * p1 - p2; }
  if (j + 2u == getCount()) { p3 = 2.0 * p2 - p1; }
  // Uniform Catmull–Rom: a smooth trace through every displaced Cα.
  let p = 0.5 * ((2.0 * p1) + (-p0 + p2) * t
    + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
    + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t);
  return vec4<f32>(p, 1.0);
}
`;

type Run = { atoms: Uint32Array; residues: Uint32Array };
type Controls = { run: number; guide: number; strength: number };
type Pulse = { started: number; fraction: number; strength: number };

const StringLine: LC<{
  host: HTMLElement;
  run: Run;
  runIndex: number;
  controls: Controls;
  choose: (run: number, guide: number) => void;
}> = ({ host, run, runIndex, controls, choose }) => {
  const atoms = useCoordinates()!.source;
  const [pulse, setPulse] = useState<Pulse | null>(null);
  useResource((dispose) => {
    const pluck = () => {
      if (controls.run !== runIndex) {
        setPulse(null);
        return;
      }
      setPulse({
        started: performance.now() / 1000,
        fraction: controls.guide / (run.atoms.length - 1),
        strength: controls.strength,
      });
    };
    const reset = () => setPulse(null);
    host.addEventListener("pluck", pluck);
    host.addEventListener("reset-string", reset);
    dispose(() => {
      host.removeEventListener("pluck", pluck);
      host.removeEventListener("reset-string", reset);
    });
  }, [host, run, runIndex, controls]);
  const age = pulse ? performance.now() / 1000 - pulse.started : 0;
  const moving = pulse !== null && age < DURATION;
  if (moving) useAnimationFrame();
  else useNoAnimationFrame();
  const rows = useRawSource(run.atoms, "u32");
  // Small proteins occupy more screen space per residue. Give them additional
  // curve detail without multiplying the cost of long multi-chain structures.
  const steps = Math.max(4, Math.ceil(512 / run.atoms.length));
  const count = (run.atoms.length - 1) * steps + 1;
  const [segments, lookup] = useMemo(() => {
    const segments = new Int32Array(count).fill(3);
    segments[0] = 1;
    segments[count - 1] = 2;
    return [
      segments,
      Uint32Array.from({ length: count }, (_, i) => Math.round(i / steps)),
    ];
  }, [run, steps]);
  const segmentSource = useRawSource(segments, "i32");
  const lookups = useRawSource(lookup, "u32");
  const parameters = useShaderRef([
    moving ? age : 0,
    pulse?.fraction ?? 0.5,
    moving ? pulse!.strength : 0,
    0,
  ]);
  const inputs = useMemo(() => [atoms, rows], [atoms, rows]);
  const guides = useShader(GUIDE, inputs);
  const original = useShader(STRING, [
    guides,
    run.atoms.length,
    steps,
  ]);
  return use(ComputeBuffer, {
    width: run.atoms.length,
    height: 1,
    format: "vec4<f32>",
    label: "experiment:string-guides",
    children: use(Compute, {
      immediate: true,
      children: use(Kernel, {
        shader: WAVE,
        args: [parameters],
        sources: inputs,
      }),
    }),
    then: (target: StorageTarget) =>
      use(StringView, {
        target,
        original,
        segmentSource,
        lookups,
        count,
        steps,
        host,
        runIndex,
        choose,
      }),
  });
};

const StringView: LC<{
  target: StorageTarget;
  original: ShaderSource;
  segmentSource: StorageSource;
  lookups: StorageSource;
  count: number;
  steps: number;
  host: HTMLElement;
  runIndex: number;
  choose: (run: number, guide: number) => void;
}> = (
  {
    target,
    original,
    segmentSource,
    lookups,
    count,
    steps,
    host,
    runIndex,
    choose,
  },
) => {
  // The native compute pass submits before this fenced draw consumer; this
  // component owns the cache until its last draw is submitted on replacement.
  useResource((dispose) => {
    dispose(() => target.buffer.destroy());
  }, [target.buffer]);
  const guides = useDerivedSource(target, { readWrite: false });
  const positions = useShader(STRING, [guides, target.length, steps]);
  return [
    <LineLayer
      positions={original}
      segments={segmentSource}
      count={count}
      color={[0.22, 0.27, 0.3, 1]}
      width={2}
      join="round"
      depthWrite={false}
    />,
    <Pick
      onPointerDown={(event, guide) => {
        if (event.button !== "right") return;
        event.preventDefault();
        event.stopPropagation();
        choose(runIndex, guide);
        host.dispatchEvent(new Event("pluck"));
      }}
      render={({ id }) => (
        <LineLayer
          id={id}
          lookups={lookups}
          positions={positions}
          segments={segmentSource}
          count={count}
          color={[0.68, 0.76, 0.63, 1]}
          width={7}
          depth={0.4}
          join="round"
        />
      )}
    />,
  ];
};

const Stage: LC<{
  host: HTMLElement;
  data: StructureData;
  runs: Run[];
  controls: Controls;
  choose: (run: number, guide: number) => void;
}> = (props) => {
  const { host, data, runs } = props;
  const { width, height } = useRenderContext();
  const camera = useMemo(() => cameraFor(data), [data]);
  useResource(() => {
    host.dataset.webgpu = "ready";
  }, [host]);
  return use(OrbitControls, {
    host: `#${host.id}-viewport`,
    target: camera.target,
    radius: camera.radius * Math.max(1, height / width),
    bearing: 0.6,
    pitch: 0.3,
    children: (
      <Pass picking>
        <Structure data={data}>
          {runs.map((run, runIndex) =>
            keyed(StringLine, runIndex, { ...props, run, runIndex })
          )}
        </Structure>
      </Pass>
    ),
  });
};

export const experiment: Experiment = {
  title: "Protein as a string",
  summary:
    "Pluck a Cα backbone and watch a damped wave travel along its sequence. A GPU string sketch, not molecular dynamics.",
  mount(host) {
    let live = true;
    let generation = 0;
    let fiber: ReturnType<typeof render> | null = null;
    const panel = document.createElement("div");
    panel.className = "experiment-panel";
    panel.innerHTML = `
      <style>
        .experiment:has(.pluck-panel) header { flex-wrap: wrap; }
        .experiment:has(.pluck-panel) h1 { font-size: clamp(1.5rem, 4vw, 3rem); }
        .pluck-panel { max-width: calc(100% - 2rem); box-sizing: border-box; color: #d4d9cd; background: #111b20e8; }
        .pluck-panel label { display: flex; align-items: center; gap: .6rem; justify-content: space-between; }
        .pluck-panel select, .pluck-panel button { font: inherit; color: inherit; background: #26352f; border: 1px solid #667669; border-radius: 4px; padding: .25rem .5rem; }
        .pluck-panel select { min-width: 0; max-width: 280px; }
        .pluck-panel button { position: static; }
        .pluck-panel input { accent-color: #b8c7a5; width: 100px; }
        .pluck-panel p { font-size: .75rem; line-height: 1.5; margin: .3rem 0; }
        .pluck-viewport { position: absolute; inset: 0; }
        @media (max-width: 600px) {
          .experiment-canvas:has(.pluck-panel) { height: auto; }
          .pluck-panel { position: relative; top: auto; left: auto; max-width: none; border-radius: 0; }
          .pluck-viewport { position: relative; height: 480px; }
        }
      </style>
      <label>Protein <select aria-label="String protein"></select></label>
      <label>Pluck at <select aria-label="Pluck residue"></select></label>
      <label>Amplitude <input aria-label="Pluck amplitude" type="range" min="1" max="7" step="0.5" value="4"></label>
      <div><button type="button" data-pluck disabled>Pluck</button> <button type="button" data-reset>Reset</button></div>
      <p>Right-click the line to pluck.<br>Drag to orbit · scroll to zoom.<br>Grey: original backbone · ends pinned.</p>
      <p>Illustrative string modes, not molecular dynamics.<br>Coordinates are not modified.</p>`;
    panel.classList.add("pluck-panel");
    const viewport = document.createElement("div");
    viewport.id = `${host.id}-viewport`;
    viewport.className = "pluck-viewport";
    host.append(panel, viewport);
    const proteinPicker = panel.querySelector<HTMLSelectElement>(
      '[aria-label="String protein"]',
    )!;
    const select = panel.querySelector<HTMLSelectElement>(
      '[aria-label="Pluck residue"]',
    )!;
    for (const structure of structures) {
      const option = document.createElement("option");
      option.value = structure.id;
      option.textContent = structure.title;
      proteinPicker.append(option);
    }
    const button = panel.querySelector<HTMLButtonElement>("[data-pluck]")!;
    const controls: Controls = { run: 0, guide: 1, strength: 4 };
    panel.querySelector<HTMLInputElement>("input")!.oninput = (event) => {
      controls.strength = Number((event.target as HTMLInputElement).value);
    };
    button.onclick = () => host.dispatchEvent(new Event("pluck"));
    panel.querySelector<HTMLButtonElement>("[data-reset]")!.onclick = () => {
      host.dispatchEvent(new Event("reset-string"));
    };
    const contextMenu = (event: Event) => event.preventDefault();
    host.addEventListener("contextmenu", contextMenu);
    const load = () => {
      const request = ++generation;
      const structure = structures.find((item) =>
        item.id === proteinPicker.value
      )!;
      if (fiber) unmount(fiber);
      fiber = null;
      host.dataset.webgpu = "loading";
      select.replaceChildren();
      select.disabled = true;
      button.disabled = true;
      const status = document.querySelector<HTMLElement>(
        "[data-webgpu-error]",
      )!;
      status.textContent = `Loading ${structure.title}…`;
      void loadStructure(
        new URL(`data/${structure.id}.bcif`, document.baseURI).href,
        structure.title,
      ).then((data) => {
        if (!live || request !== generation) return;
        const trace = traceTable(data, resolve(protein(), data).indices);
        const runs: Run[] = [];
        for (let r = 0; r < trace.runs.length - 1; r++) {
          const start = trace.runs[r], end = trace.runs[r + 1];
          if (end - start < 3) continue;
          runs.push({
            atoms: trace.atom.slice(start, end),
            residues: trace.residue.slice(start, end),
          });
        }
        const choose = (run: number, guide: number) => {
          controls.run = run;
          controls.guide = Math.max(
            1,
            Math.min(runs[run].atoms.length - 2, guide),
          );
          select.value = `${run}:${controls.guide}`;
        };
        runs.forEach((run, index) => {
          for (let i = 1; i < run.residues.length - 1; i++) {
            const r = run.residues[i];
            const { residues, chains } = data.topology;
            const option = document.createElement("option");
            option.value = `${index}:${i}`;
            option.textContent = `${residues.comp[r]} ${
              residues.authSeq[r]
            } · ${chains.authId[residues.chain[r]]}`;
            select.append(option);
          }
        });
        choose(0, Math.floor(runs[0].atoms.length * 0.4));
        select.onchange = () => {
          const [run, guide] = select.value.split(":").map(Number);
          choose(run, guide);
        };
        select.disabled = false;
        button.disabled = false;
        status.textContent = "";
        host.dataset.structure = structure.id;
        fiber = render(use(SharedWebGPU, {
          fallback: (error: unknown) => {
            host.dataset.webgpu = "error";
            document.querySelector("[data-webgpu-error]")!.textContent = String(
              error,
            );
            return null;
          },
          children: use(AutoCanvas, {
            selector: `#${viewport.id}`,
            samples: 4,
            backgroundColor: [0.025, 0.04, 0.05, 1],
            children: use(Stage, { host, data, runs, controls, choose }),
          }),
        }));
      }).catch((error) => {
        if (!live || request !== generation) return;
        host.dataset.webgpu = "error";
        status.textContent = String(error);
      });
    };
    proteinPicker.onchange = load;
    load();
    return () => {
      live = false;
      if (fiber) unmount(fiber);
      host.removeEventListener("contextmenu", contextMenu);
      panel.remove();
      viewport.remove();
    };
  },
};
