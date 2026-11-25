/** @jsx LiveReact.createElement */
/**
 * What is the backbone? The canonical trace runs through each residue's
 * N, Cα and C. The variants keep N and C, the atoms of the peptide bonds, and
 * swap Cα for another point: Cβ (an ideal virtual Cβ for glycine), the
 * side-chain centroid, or a point 3 Å out along Cα→Cβ. Each trace is a
 * centripetal Catmull–Rom spline through its guide points, so the line
 * bulges out where side chains are big, and helices, strands and turns take
 * different shapes. "By residue" styling makes the line carry the amino acid
 * too: width follows side-chain size, colour its chemistry.
 *
 * Molecular data and the trajectory are molgpu's. The CPU only prepares a
 * recipe from topology (which atoms make each guide point, which guides each
 * line vertex blends). The spline itself is a WGSL function that use.gpu's
 * LineLayer calls per vertex, reading the live coordinates from
 * `useCoordinates()`, so the trace follows `<Trajectory>` every frame with no
 * readback or CPU rebuild.
 */
import {
  keyed,
  type LC,
  type LiveElement,
  React as LiveReact,
  render,
  unmount,
  use,
  useMemo,
  useResource,
} from "@use-gpu/live";
import { AutoCanvas } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  LineLayer,
  Pass,
  useRawSource,
  useShader,
} from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { useAnimationFrame } from "@use-gpu/frame";
import { coordinateBounds, type StructureData } from "@molgpu/table";
import { protein } from "@molgpu/select";
import {
  BallAndStick,
  Structure,
  TimelineProvider,
  Trajectory,
} from "@molgpu/viewer";
import { useCoordinates } from "@molgpu/viewer/advanced";
import { frameCurve } from "@molgpu/timeline";
import crambinUrl from "../../../packages/io/test/fixtures/1crn.bcif?url";
import motionUrl from "../../assets/1crn-motion.xtc?url";
import { loadStructure } from "../demos/data.ts";
import { OrbitControls, SharedWebGPU } from "../demos/viewer.tsx";
import type { Experiment } from "../pages/experiments.tsx";

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

// ── Residue chemistry ───────────────────────────────────────────────────────

/** Heavy side-chain atoms beyond Cα per amino acid: a proxy for its bulk. */
const SIZE: Record<string, number> = {
  GLY: 0,
  ALA: 1,
  SER: 2,
  CYS: 2,
  PRO: 3,
  THR: 3,
  VAL: 3,
  ASP: 4,
  ASN: 4,
  ILE: 4,
  LEU: 4,
  MET: 4,
  GLU: 5,
  GLN: 5,
  LYS: 5,
  HIS: 6,
  PHE: 7,
  ARG: 7,
  TYR: 8,
  TRP: 10,
};

/** Colour by chemistry: hydrophobic, aromatic, polar, +, −, and Gly/Pro. */
const CLASS_COLOR: [string[], Rgba][] = [
  [["ALA", "VAL", "ILE", "LEU", "MET", "CYS"], [1, 0.74, 0.3, 1]],
  [["PHE", "TRP", "TYR"], [0.95, 0.5, 0.2, 1]],
  [["SER", "THR", "ASN", "GLN"], [0.3, 0.85, 0.75, 1]],
  [["LYS", "ARG", "HIS"], [0.35, 0.55, 1, 1]],
  [["ASP", "GLU"], [1, 0.35, 0.4, 1]],
  [["GLY", "PRO"], [0.85, 0.85, 0.9, 1]],
];
const classColor = (comp: string): Rgba =>
  CLASS_COLOR.find(([names]) => names.includes(comp))?.[1] ??
    [0.7, 0.7, 0.7, 1];

// ── Guide atoms ─────────────────────────────────────────────────────────────

type TraceId =
  | "ncac"
  | "ncbc"
  | "nscc"
  | "nfarc"
  | "ca"
  | "cb"
  | "centroid";

/**
 * N–X–C traces pass through each residue's amide N and carbonyl C, the
 * canonical backbone, with X the third point: Cα (canonical), Cβ, the
 * side-chain centroid, or a point 3 Å out along Cα→Cβ. Keeping N and C fixed
 * means only the middle point moves, so the line bulges out wherever side
 * chains are big. Single-point traces (Cα, Cβ, centroid) are for comparison.
 */
const TRACES: { id: TraceId; label: string; color: Rgba }[] = [
  { id: "ncac", label: "N–Cα–C (canonical)", color: [0.92, 0.94, 1, 1] },
  { id: "ncbc", label: "N–Cβ–C", color: [1, 0.72, 0.3, 1] },
  { id: "nscc", label: "N–centroid–C", color: [1, 0.45, 0.7, 1] },
  { id: "nfarc", label: "N–(Cα+3Å·Cβ)–C", color: [0.4, 0.9, 0.6, 1] },
  { id: "ca", label: "Cα only", color: [0.6, 0.65, 0.8, 1] },
  { id: "cb", label: "Cβ only", color: [0.35, 0.85, 1, 1] },
  { id: "centroid", label: "Centroid only", color: [0.65, 0.5, 1, 1] },
];

const BACKBONE = new Set(["N", "CA", "C", "O", "OXT"]);

/** Topology rows of one protein residue's named heavy atoms and side chain. */
type ResidueRows = {
  chain: number;
  seq: number;
  comp: string;
  atoms: Map<string, number>;
  side: number[];
};

/** Protein residues in order (first altloc wins, hydrogens skipped). Rows
 * only: positions are read on the GPU from the live coordinates. */
const proteinRows = (data: StructureData): ResidueRows[] => {
  const { atoms, residues } = data.topology;
  const out = new Map<number, ResidueRows>();
  for (let a = 0; a < atoms.count; a++) {
    const r = atoms.residue[a];
    if (residues.polymer[r] !== "protein") continue;
    let res: ResidueRows | undefined = out.get(r);
    if (!res) {
      res = {
        chain: residues.chain[r],
        seq: Number(residues.authSeq[r]),
        comp: residues.comp[r],
        atoms: new Map(),
        side: [],
      };
      out.set(r, res);
    }
    const name = atoms.name[a];
    if (res.atoms.has(name) || atoms.element[a] === 1 /* H */) continue;
    res.atoms.set(name, a);
    if (!BACKBONE.has(name)) res.side.push(a);
  }
  return [...out.entries()].sort(([a], [b]) => a - b).map(([, r]) => r);
};

/**
 * How the shader finds one guide point. `kind` picks the rule; `a`, `b`, `c`
 * are atom rows (or, for a centroid, the first entry and count in a list of
 * side-chain rows). Everything here comes from topology: it never changes as
 * the coordinates move.
 */
const enum Kind {
  Atom = 0, // the atom at a
  CB = 1, // Cβ at a, else a virtual Cβ from N, Cα, C at a, b, c
  Reach = 2, // 3 Å from Cα (b) towards Cβ (a, or virtual from a, b, c)
  Centroid = 3, // mean of side-chain rows [a, a + b); Cα (c) when b = 0
}

/** One guide point's rule: kind, a, b, c, and the N–Cα–C for a virtual Cβ. */
type Guide = [
  kind: Kind,
  a: number,
  b: number,
  c: number,
  n: number,
  ca: number,
  cc: number,
];

const NONE = 0xffffffff;

/** Guide rules per residue for a trace, or null if an atom it needs is missing. */
const guides = (
  res: ResidueRows,
  trace: TraceId,
  sideList: number[],
): Guide[] | null => {
  const n = res.atoms.get("N"),
    ca = res.atoms.get("CA"),
    c = res.atoms.get("C");
  if (n === undefined || ca === undefined || c === undefined) return null;
  const cb = res.atoms.get("CB") ?? NONE;
  const atom = (row: number): Guide => [Kind.Atom, row, 0, 0, n, ca, c];
  const beta: Guide = [Kind.CB, cb, 0, 0, n, ca, c];
  const reach: Guide = [Kind.Reach, cb, ca, 0, n, ca, c];
  const centroid = (): Guide => {
    const start = sideList.length;
    sideList.push(...res.side);
    return [Kind.Centroid, start, res.side.length, ca, n, ca, c];
  };
  switch (trace) {
    case "ncac":
      return [atom(n), atom(ca), atom(c)];
    case "ncbc":
      return [atom(n), beta, atom(c)];
    case "nscc":
      return [atom(n), centroid(), atom(c)];
    case "nfarc":
      return [atom(n), reach, atom(c)];
    case "ca":
      return [atom(ca)];
    case "cb":
      return [beta];
    case "centroid":
      return [centroid()];
  }
};

const SAMPLES = 8; // spline points per guide step (single-point traces)

type Style = "trace" | "residue";

/**
 * A trace's recipe, from topology only: guide rules, plus for every line
 * vertex the four guides of its Catmull–Rom segment and its parameter u.
 * Colours, widths and segment codes are per vertex too; none of it changes
 * when the coordinates do, so it is uploaded once.
 */
const buildRecipe = (
  rows: ResidueRows[],
  trace: TraceId,
  style: Style,
  reference: boolean,
) => {
  const flat = TRACES.find((t) => t.id === trace)!.color;
  const samples = trace.startsWith("n") ? 4 : SAMPLES;
  const look = (res: ResidueRows): [Rgba, number] =>
    style === "residue" && !reference
      ? [classColor(res.comp), 2 + 1.1 * (SIZE[res.comp] ?? 3)]
      : [flat, reference ? 2 : 4];

  const guideList: number[] = [], sideList: number[] = [];
  // Runs of consecutive residues joined by a peptide bond (by numbering and
  // chain; a gap in either ends the run).
  const runs: { guide: number; res: ResidueRows }[][] = [];
  let run: { guide: number; res: ResidueRows }[] = [];
  let prev: ResidueRows | null = null;
  for (const res of rows) {
    const g = guides(res, trace, sideList);
    const joined = prev && g && res.chain === prev.chain &&
      res.seq - prev.seq === 1;
    if (!joined && run.length) runs.push(run), run = [];
    for (const rule of g ?? []) {
      run.push({ guide: guideList.length / 7, res });
      guideList.push(...rule);
    }
    prev = g ? res : null;
  }
  if (run.length) runs.push(run);

  // Per vertex: guides i0..i3 (i0/i3 = i1/i2 at run ends: the shader
  // mirrors them), u, segment code, colour, width.
  const quad: number[] = [], segments: number[] = [];
  const colors: number[] = [], widths: number[] = [];
  for (const r of runs.filter((r) => r.length > 1)) {
    const start = segments.length;
    const g = (i: number) => r[Math.max(0, Math.min(r.length - 1, i))].guide;
    for (let i = 0; i < r.length - 1; i++) {
      const [ca, wa] = look(r[i].res), [cb, wb] = look(r[i + 1].res);
      const last = i === r.length - 2;
      for (let s = 0; s <= (last ? samples : samples - 1); s++) {
        const u = s / samples;
        // -1 marks a mirrored end guide (no point before / after the run).
        quad.push(
          i > 0 ? g(i - 1) : NONE,
          g(i),
          g(i + 1),
          i + 2 < r.length ? g(i + 2) : NONE,
          // u as raw f32 bits, so each vertex is one 5×u32 record.
          new Uint32Array(new Float32Array([u]).buffer)[0],
        );
        const own = u < 0.5;
        colors.push(...(own ? ca : cb));
        widths.push(own ? wa : wb);
        segments.push(3);
      }
    }
    segments[start] = 1;
    segments[segments.length - 1] = 2;
  }
  // One u32 buffer: the side-chain row list, then 7 words per guide rule.
  // WebGPU allows 8 storage buffers per vertex stage, and LineLayer already
  // uses some, so the recipe packs into two (rules, vertices).
  return {
    count: segments.length,
    rules: new Uint32Array([sideList.length, ...sideList, ...guideList]),
    vertices: new Uint32Array(quad),
    segments: new Int32Array(segments),
    colors: new Float32Array(colors),
    widths: new Float32Array(widths),
  };
};

/**
 * The trace's positions, computed per vertex on the GPU from the live atom
 * coordinates: the four guide points of the vertex's segment (each by its
 * rule), then a centripetal Catmull–Rom point at u. Nothing is computed on
 * the CPU per frame; a moving `<Trajectory>` simply changes `getAtom`.
 */
const TRACE_POSITION = wgsl`
@link fn getAtom(i: u32) -> vec4<f32>;
@link fn getRule(i: u32) -> u32;
@link fn getVertex(i: u32) -> u32;

// Rules: word 0 is the side-chain row count S, then S rows, then 7 words
// per guide.
fn getSide(i: u32) -> u32 { return getRule(1u + i); }
fn getGuide(i: u32) -> u32 { return getRule(1u + getRule(0u) + i); }
fn getParam(i: u32) -> f32 { return bitcast<f32>(getVertex(i * 5u + 4u)); }

const NONE = 0xffffffffu;

fn atom(i: u32) -> vec3<f32> { return getAtom(i).xyz; }

// The standard ideal Cβ from N, Cα and C.
fn virtualCB(n: vec3<f32>, ca: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
  let b = ca - n; let cc = c - ca; let a = cross(b, cc);
  return -0.58273431 * a + 0.56802827 * b - 0.54067466 * cc + ca;
}

fn beta(g: u32) -> vec3<f32> {
  let cb = getGuide(g * 7u + 1u);
  if (cb != NONE) { return atom(cb); }
  return virtualCB(atom(getGuide(g * 7u + 4u)), atom(getGuide(g * 7u + 5u)), atom(getGuide(g * 7u + 6u)));
}

fn guide(g: u32) -> vec3<f32> {
  let kind = getGuide(g * 7u);
  let a = getGuide(g * 7u + 1u);
  let b = getGuide(g * 7u + 2u);
  if (kind == 0u) { return atom(a); }
  if (kind == 1u) { return beta(g); }
  if (kind == 2u) {
    let ca = atom(b);
    return ca + normalize(beta(g) - ca) * 3.0;
  }
  if (b == 0u) { return atom(getGuide(g * 7u + 3u)); }
  var m = vec3<f32>(0.0);
  for (var k = 0u; k < b; k++) { m += atom(getSide(a + k)); }
  return m / f32(b);
}

fn knot(a: vec3<f32>, b: vec3<f32>) -> f32 { return max(sqrt(length(b - a)), 1e-4); }

fn lerpAt(a: vec3<f32>, b: vec3<f32>, ta: f32, tb: f32, t: f32) -> vec3<f32> {
  return ((tb - t) * a + (t - ta) * b) / (tb - ta);
}

@export fn getTracePosition(i: u32) -> vec4<f32> {
  let base = i * 5u;
  let q0 = getVertex(base); let q3 = getVertex(base + 3u);
  let p1 = guide(getVertex(base + 1u));
  let p2 = guide(getVertex(base + 2u));
  // Mirror a missing end guide through its neighbour.
  var p0 = 2.0 * p1 - p2; if (q0 != NONE) { p0 = guide(q0); }
  var p3 = 2.0 * p2 - p1; if (q3 != NONE) { p3 = guide(q3); }
  let t0 = 0.0; let t1 = t0 + knot(p0, p1); let t2 = t1 + knot(p1, p2); let t3 = t2 + knot(p2, p3);
  let t = mix(t1, t2, getParam(i));
  let a1 = lerpAt(p0, p1, t0, t1, t); let a2 = lerpAt(p1, p2, t1, t2, t); let a3 = lerpAt(p2, p3, t2, t3, t);
  let b1 = lerpAt(a1, a2, t0, t2, t); let b2 = lerpAt(a2, a3, t1, t3, t);
  return vec4<f32>(lerpAt(b1, b2, t1, t2, t), 1.0);
}
`;

/** `reference` draws a thin flat line whatever the style (canonical beside others). */
const TraceLine: LC<{
  rows: ResidueRows[];
  trace: TraceId;
  style: Style;
  reference: boolean;
}> = ({ rows, trace, style, reference }) => {
  const atoms = useCoordinates()?.source;
  const recipe = useMemo(
    () => buildRecipe(rows, trace, style, reference),
    [rows, trace, style, reference],
  );
  const rules = useRawSource(recipe.rules, "u32");
  const vertices = useRawSource(recipe.vertices, "u32");
  const segments = useRawSource(recipe.segments, "i32");
  const colors = useRawSource(recipe.colors, "vec4<f32>");
  const widths = useRawSource(recipe.widths, "f32");
  const positions = useShader(TRACE_POSITION, [atoms, rules, vertices]);
  if (!atoms || !recipe.count) return null;
  return use(LineLayer, {
    positions,
    segments,
    colors,
    widths,
    count: recipe.count,
    join: "round",
    depth: 0.5,
  });
};

// ── Scene ───────────────────────────────────────────────────────────────────

/** `motion` plays the crambin XTC through `<Trajectory>`. */
type State = {
  traces: Set<TraceId>;
  style: Style;
  atoms: boolean;
  motion: boolean;
};

// The XTC is a seamless 60-frame loop (see examples/motion.tsx).
const MOTION = frameCurve({ frames: 59, fps: 59 / 4, loop: true });

/** Published on the host for tests and screenshots. */
const useReadout = (host: string, key: string) =>
  useResource(() => {
    const element = document.querySelector<HTMLElement>(host);
    if (!element) return;
    element.dataset.webgpu = "ready";
    element.dataset.traces = key;
  }, [host, key]);

const Stage: LC<{ host: string; data: StructureData; state: State }> = (
  { host, data, state },
) => {
  // Re-render each frame so the DOM controls take effect immediately.
  useAnimationFrame();
  const rows = useMemo(() => proteinRows(data), [data]);
  const center = useMemo(
    () => coordinateBounds(data)!.center as Vec3,
    [data],
  );
  const active = TRACES.filter((t) => state.traces.has(t.id));
  useReadout(host, `${active.map((t) => t.id).join(",")}:${state.style}`);
  return use(OrbitControls, {
    host,
    target: center,
    radius: 32,
    bearing: 0.6,
    pitch: 0.3,
    children: (
      <Pass lights>
        <AmbientLight color={[0.6, 0.7, 1]} intensity={0.45} />
        <DirectionalLight
          direction={[-0.5, -0.6, -1]}
          color={[1, 0.96, 0.9]}
          intensity={1.4}
        />
        <TimelineProvider time={performance.now() / 1000}>
          <Structure data={data}>
            {motionOr(state.motion, [
              state.atoms && (
                <BallAndStick
                  select={protein()}
                  ball={0.12}
                  stick={0.06}
                  color={[0.35, 0.38, 0.48, 1]}
                />
              ),
              ...active.map((t) =>
                keyed(TraceLine, t.id, {
                  rows,
                  trace: t.id,
                  style: state.style,
                  // The canonical trace stays a thin white reference beside others.
                  reference: t.id === "ncac" && active.length > 1,
                })
              ),
            ])}
          </Structure>
        </TimelineProvider>
      </Pass>
    ),
  });
};

/** Wrap `children` in the XTC `<Trajectory>` when motion is on. Every trace
 * reads `useCoordinates()`, so it follows whichever provider is nearest. */
const motionOr = (motion: boolean, children: LiveElement[]) =>
  motion
    ? <Trajectory src={motionUrl} frame={MOTION}>{children}</Trajectory>
    : children;

const Root: LC<{ host: string; data: StructureData; state: State }> = (
  props,
) =>
  use(SharedWebGPU, {
    fallback: (error: unknown) => {
      const element = document.querySelector<HTMLElement>(props.host);
      if (element) {
        element.dataset.webgpu = "failed";
        const status = document.querySelector("[data-webgpu-error]");
        if (status) status.textContent = String(error);
      }
    },
    children: use(AutoCanvas, {
      selector: props.host,
      samples: 4,
      backgroundColor: [0.01, 0.012, 0.025, 1],
      children: use(Stage, props),
    }),
  });

export const experiment: Experiment = {
  title: "What is the backbone?",
  summary:
    "Crambin's backbone as splines through N and C with Cα swapped for Cβ, the side-chain centroid or a reach point, computed on the GPU from live coordinates as an XTC trajectory plays.",
  mount(element, params) {
    const host = `#${element.id}`;
    // ?traces=ncac,ncbc picks the traces, ?style=trace|residue the look
    // ?atoms=1 shows faint atoms and ?motion=0 holds the crystal pose: for
    // tests and screenshots.
    const picked = (params.get("traces") ?? "ncac,ncbc").split(",");
    const state: State = {
      traces: new Set(
        TRACES.map((t) => t.id).filter((id) => picked.includes(id)),
      ),
      style: params.get("style") === "trace" ? "trace" : "residue",
      atoms: params.get("atoms") === "1",
      motion: params.get("motion") !== "0",
    };
    const panel = document.createElement("div");
    panel.className = "experiment-panel";
    const checkbox = (
      label: string,
      on: boolean,
      set: (v: boolean) => void,
    ) => {
      const row = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = on;
      box.onchange = () => set(box.checked);
      row.append(box, ` ${label}`);
      panel.append(row);
    };
    for (const t of TRACES) {
      checkbox(t.label, state.traces.has(t.id), (on) => {
        if (on) state.traces.add(t.id);
        else state.traces.delete(t.id);
      });
    }
    const style = document.createElement("select");
    style.setAttribute("aria-label", "Line style");
    for (
      const [value, text] of [["residue", "By residue"], ["trace", "By trace"]]
    ) {
      style.append(new Option(text, value, false, value === state.style));
    }
    style.onchange = () => state.style = style.value as Style;
    panel.append(style);
    checkbox("Atoms", state.atoms, (on) => state.atoms = on);
    checkbox("Play motion (XTC)", state.motion, (on) => state.motion = on);
    element.append(panel);
    let fiber: ReturnType<typeof render> | null = null;
    let live = true;
    void loadStructure(crambinUrl, "Crambin (1CRN)").then((data) => {
      if (live) fiber = render(use(Root, { host, data, state }));
    });
    return () => {
      live = false;
      if (fiber) unmount(fiber);
      panel.remove();
    };
  },
};
