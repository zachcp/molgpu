// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
/**
 * Serine protease mechanism. Trypsin bound to BPTI (PDB 2PTC): BPTI's Lys15
 * sits in trypsin's pocket with its Lys15–Ala16 peptide bond poised over the
 * catalytic triad (Asp102, His57, Ser195; chymotrypsin numbering). A glowing
 * pulse walks the mechanism's curly arrows one beat at a time. It stands for
 * an electron pair or a proton moving between real atom positions, not a
 * single transferred electron.
 *
 * Molecular data and representations are molgpu's; the pulse is a use.gpu
 * PointLayer in HDR, and the glow is gfp.tsx's bloom.
 */
import {
  type LC,
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
  FontLoader,
  Pass,
  PointLayer,
  SDFFontProvider,
} from "@use-gpu/workbench";
import { useAnimationFrame } from "@use-gpu/frame";
import type { StructureData } from "@molgpu/table";
import { and, chain, or, residues } from "@molgpu/select";
import { byElement } from "@molgpu/fields";
import { BallAndStick, Cartoon, Label, Structure } from "@molgpu/viewer";
import complexUrl from "../../../packages/io/test/fixtures/2ptc.bcif?url";
import { loadStructure } from "../demos/data.ts";
import { OrbitControls, SharedWebGPU } from "../demos/viewer.tsx";
import fontUrl from "../../assets/font.ttf?url";
import type { Experiment } from "../pages/experiments.tsx";
import { Bloom } from "./gfp.tsx";

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// ── Mechanism ───────────────────────────────────────────────────────────────

/** An atom by author chain, author sequence number and atom name. */
type AtomRef = [chain: string, seq: number, name: string];

/** One curly arrow: the pulse travels `from` → `to` under `caption`. */
type Beat = { from: AtomRef; to: AtomRef; color: Rgba; caption: string };

const PROTON: Rgba = [6, 4.2, 1.2, 1]; // warm: a proton hop
const PAIR: Rgba = [1.4, 4, 7, 1]; // cool: an electron pair

const BEATS: Beat[] = [
  {
    from: ["E", 102, "OD2"],
    to: ["E", 57, "ND1"],
    color: PAIR,
    caption:
      "Asp102 holds His57 in place and makes it a stronger base (the catalytic triad).",
  },
  {
    from: ["E", 195, "OG"],
    to: ["E", 57, "NE2"],
    color: PROTON,
    caption: "His57 pulls the proton off Ser195's hydroxyl.",
  },
  {
    from: ["E", 195, "OG"],
    to: ["I", 15, "C"],
    color: PAIR,
    caption:
      "Ser195's oxygen, now a strong nucleophile, attacks the carbonyl carbon of the Lys15–Ala16 peptide bond.",
  },
  {
    from: ["I", 15, "C"],
    to: ["I", 15, "O"],
    color: PAIR,
    caption:
      "A new O–C bond forms; the carbonyl's electrons move onto its oxygen, and the oxyanion hole (Gly193, Ser195 NH) holds the negative charge.",
  },
  {
    from: ["E", 57, "NE2"],
    to: ["I", 16, "N"],
    color: PROTON,
    caption:
      "The intermediate collapses: C=O reforms, the Lys15–Ala16 bond breaks, and His57 hands its proton to the leaving Ala16 amine.",
  },
];

const BEAT = 2.6; // seconds per arrow
const REST = 1.4; // pause before the cycle repeats
const CYCLE = BEATS.length * BEAT + REST;

/** Beat index and progress through it at time `t`; `beat` is -1 at rest. */
const timeline = (t: number) => {
  const c = ((t % CYCLE) + CYCLE) % CYCLE;
  const beat = Math.floor(c / BEAT);
  return beat < BEATS.length
    ? { beat, u: (c - beat * BEAT) / BEAT }
    : { beat: -1, u: 0 };
};

/** Positions of every atom the beats name, looked up once per structure. */
const atomPositions = (data: StructureData) => {
  const { atoms, residues: res, chains } = data.topology;
  const wanted = new Map(
    BEATS.flatMap(({ from, to }) => [from, to]).map((
      ref,
    ) => [ref.join(":"), null as Vec3 | null]),
  );
  for (let a = 0; a < atoms.count; a++) {
    const r = atoms.residue[a];
    const key = `${chains.authId[res.chain[r]]}:${res.authSeq[r]}:${
      atoms.name[a]
    }`;
    if (wanted.get(key) === null) {
      const p = data.positions;
      wanted.set(key, [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]]);
    }
  }
  return (ref: AtomRef) => {
    const p = wanted.get(ref.join(":"));
    if (!p) throw new Error(`2PTC has no atom ${ref.join(" ")}`);
    return p;
  };
};

// ── Scene ───────────────────────────────────────────────────────────────────

const TRYPSIN = chain("E");
const BPTI = chain("I");
const SITE = or(
  and(TRYPSIN, residues([57, 57])),
  and(TRYPSIN, residues([102, 102])),
  and(TRYPSIN, residues([189, 195])), // pocket floor and oxyanion hole
  and(BPTI, residues([15, 15])),
);
/** Ala16 on its own, so the C15–N16 bond belongs to neither selection. */
const LEAVING = and(BPTI, residues([16, 16]));

const FONTS = [{ family: "sans", style: "normal", weight: 400, src: fontUrl }];

/** Residue labels: the triad, the oxyanion hole and BPTI's scissile bond. */
const LABELS: [query: ReturnType<typeof and>, text: string][] = [
  [and(TRYPSIN, residues([57, 57])), "His57"],
  [and(TRYPSIN, residues([102, 102])), "Asp102"],
  [and(TRYPSIN, residues([195, 195])), "Ser195"],
  [and(TRYPSIN, residues([193, 193])), "Gly193"],
  [and(BPTI, residues([15, 15])), "Lys15 (BPTI)"],
  [and(BPTI, residues([16, 16])), "Ala16"],
];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** The point `d` ångström from `a` towards `b`. */
const toward = (a: Vec3, b: Vec3, d: number): Vec3 => {
  const v = sub(b, a);
  return lerp(a, b, d / Math.hypot(...v));
};
/** How far a beat's arrow has travelled: the Pulse's own easing. */
const arrive = (u: number) => smooth(clamp01((u - 0.15) / 0.6));

/**
 * What each beat has done to the structure by time (beat, u), 0 → 1:
 * the proton leaving Ser195, the O–C bond forming, the oxyanion forming,
 * the C–N bond breaking. Earlier beats stay done; the rest is the end state.
 */
const chemistry = (beat: number, u: number) => {
  const now = beat < 0 ? BEATS.length : beat;
  const done = (b: number) => now > b ? 1 : now === b ? arrive(u) : 0;
  return {
    proton: done(1),
    attack: done(2),
    oxyanion: done(3),
    cleave: done(4),
  };
};

/** A bond as a row of shaded dots from `a` to `b`. */
const Bond: LC<{ a: Vec3; b: Vec3; color: Rgba; size?: number }> = (
  { a, b, color, size = 7 },
) =>
  Array.from({ length: 9 }, (_, k) => (
    <PointLayer
      position={[...lerp(a, b, k / 8), 1]}
      size={size}
      color={color}
      count={1}
      shape="circle"
      shaded
    />
  ));

const NEW_BOND: Rgba = [0.8, 3.2, 3.6, 1]; // the forming O–C bond glows
const OLD_BOND: Rgba = [0.75, 0.75, 0.8, 1];
const HYDROGEN: Rgba = [4, 4, 4.4, 1];

/** The moving proton, the two bonds that change, and the charges. */
const Chemistry: LC<{ at: (ref: AtomRef) => Vec3; beat: number; u: number }> = (
  { at, beat, u },
) => {
  const { proton, attack, oxyanion, cleave } = chemistry(beat, u);
  const og = at(["E", 195, "OG"]), ne2 = at(["E", 57, "NE2"]);
  const c = at(["I", 15, "C"]), o = at(["I", 15, "O"]), n = at(["I", 16, "N"]);
  // The proton rides Ser195 OG, then His57 NE2, then the Ala16 amine.
  const h = cleave > 0
    ? lerp(toward(ne2, og, 1.01), toward(n, ne2, 1.01), cleave)
    : lerp(toward(og, ne2, 0.97), toward(ne2, og, 1.01), proton);
  const charges: [Vec3, string, Rgba][] = [];
  if (proton > 0.5 && cleave < 0.5) charges.push([ne2, "+", [1, 0.7, 0.3, 1]]);
  if (oxyanion > 0.5 && cleave < 0.5) charges.push([o, "−", [0.5, 0.8, 1, 1]]);
  return [
    <PointLayer
      position={[...h, 1]}
      size={13}
      color={HYDROGEN}
      count={1}
      shape="circle"
      shaded
    />,
    attack > 0 && <Bond a={og} b={lerp(og, c, attack)} color={NEW_BOND} />,
    cleave < 1 && (
      <Bond
        a={c}
        b={n}
        color={OLD_BOND.map((x, i) => i < 3 ? x * (1 - cleave) : 1) as Rgba}
      />
    ),
    ...charges.map(([p, text, color]) => (
      <Label at={p} text={text} size={30} color={color} offset={[0, 1.1, 0]} />
    )),
  ].filter(Boolean);
};

/** The glowing pulse: a head and a fading tail along one arrow. */
const Pulse: LC<{ from: Vec3; to: Vec3; color: Rgba; u: number }> = (
  { from, to, color, u },
) => {
  // Travel in the middle of the beat, linger as a flare at both ends.
  const travel = smooth(clamp01((u - 0.15) / 0.6));
  const flare = 1 + 1.5 * Math.max(0, 1 - Math.abs(u - 0.8) / 0.15);
  const fade = clamp01(u / 0.08) * clamp01((1 - u) / 0.08);
  return [0, 1, 2, 3, 4].map((k) => {
    const w = (1 - k / 5) * fade;
    return (
      <PointLayer
        // A homogeneous point: a bare [x, y, z] binds with w = 0 and
        // projects to infinity (see annotations.ts).
        position={[...lerp(from, to, clamp01(travel - k * 0.06)), 1]}
        size={(k ? 14 : 20) * (k ? 1 : flare) * (0.5 + 0.5 * w)}
        color={[color[0] * w, color[1] * w, color[2] * w, 1] as Rgba}
        // A singular position draws nothing without an explicit count.
        count={1}
        shape="circle"
        depthTest={false}
      />
    );
  });
};

/** Published on the host for tests and screenshots. */
const useReadout = (host: string, beat: number) =>
  useResource(() => {
    const element = document.querySelector<HTMLElement>(host);
    if (!element) return;
    element.dataset.webgpu = "ready";
    element.dataset.beat = String(beat);
    const caption = element.querySelector(".experiment-caption");
    if (caption) {
      caption.textContent = beat < 0
        ? "Acyl-enzyme: Lys15 is now bonded to Ser195. Water will later free it and reset the enzyme."
        : `${beat + 1}/${BEATS.length} · ${BEATS[beat].caption}`;
    }
  }, [host, beat]);

/** `frozen` holds time (screenshots); otherwise t runs from `origin`.
 * `labels` shows residue names and the step caption. */
type Clock = {
  origin: number;
  speed: number;
  frozen: number | null;
  labels: boolean;
};

const Stage: LC<{ host: string; data: StructureData; clock: Clock }> = (
  { host, data, clock },
) => {
  useAnimationFrame();
  const t = clock.frozen ??
    (performance.now() - clock.origin) / 1000 * clock.speed;
  const { beat, u } = timeline(t);
  useReadout(host, beat);
  const at = useMemo(() => atomPositions(data), [data]);
  const center = at(["E", 195, "OG"]);
  const step = beat >= 0 ? BEATS[beat] : null;
  // Drag to rotate, wheel to zoom. Upstream OrbitControls reseeds its
  // state when bearing or pitch change, so the pose here stays fixed.
  return use(OrbitControls, {
    host,
    target: center,
    radius: 30,
    bearing: 0.9,
    pitch: 0.25,
    children: (
      <Bloom strength={0.6}>
        <Pass lights>
          <AmbientLight color={[0.55, 0.65, 1]} intensity={0.3} />
          <DirectionalLight
            direction={[-0.5, -0.6, -1]}
            color={[1, 0.95, 0.88]}
            intensity={1.6}
          />
          <DirectionalLight
            direction={[0.8, 0.2, 0.7]}
            color={[0.5, 0.7, 1]}
            intensity={0.6}
          />
          <Structure data={data}>
            <Cartoon
              select={TRYPSIN}
              color={[0.32, 0.38, 0.55, 1]}
              material={{ type: "pbr", roughness: 0.6 }}
            />
            <Cartoon
              select={BPTI}
              color={[0.85, 0.55, 0.32, 1]}
              material={{ type: "pbr", roughness: 0.6 }}
            />
            <BallAndStick
              select={SITE}
              ball={0.28}
              stick={0.16}
              color={byElement()}
              material={{ type: "pbr", roughness: 0.4 }}
            />
            <BallAndStick
              select={LEAVING}
              ball={0.28}
              stick={0.16}
              color={byElement()}
              material={{ type: "pbr", roughness: 0.4 }}
            />
            <FontLoader fonts={FONTS}>
              <SDFFontProvider>
                <Chemistry at={at} beat={beat} u={u} />
                {clock.labels && LABELS.map(([select, text]) => (
                  <Label
                    select={select}
                    text={text}
                    size={15}
                    color={[0.95, 0.97, 1, 1]}
                    offset={[0, 1.4, 0]}
                  />
                ))}
              </SDFFontProvider>
            </FontLoader>
          </Structure>
          {step && (
            <Pulse
              from={at(step.from)}
              to={at(step.to)}
              color={step.color}
              u={u}
            />
          )}
        </Pass>
      </Bloom>
    ),
  });
};

const Root: LC<{ host: string; data: StructureData; clock: Clock }> = (props) =>
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
      backgroundColor: [0, 0, 0, 1],
      children: use(Stage, props),
    }),
  });

export const experiment: Experiment = {
  title: "Cutting a peptide bond",
  summary:
    "Trypsin's catalytic triad at work on BPTI: a glowing pulse traces each proton hop and electron-pair arrow of the serine protease mechanism.",
  mount(element, params) {
    const host = `#${element.id}`;
    // ?t=<s> starts mid-way, ?speed=<x> scales time and ?freeze holds it at
    // t, and ?labels=0 starts with labels off: for tests and screenshots.
    const speed = Number(params.get("speed") ?? 1) || 1;
    const start = Number(params.get("t") ?? 0) || 0;
    const clock: Clock = {
      origin: performance.now() - start * 1000 / speed,
      speed,
      frozen: params.has("freeze") ? start : null,
      labels: params.get("labels") !== "0",
    };
    const caption = document.createElement("p");
    caption.className = "experiment-caption";
    caption.setAttribute("aria-live", "polite");
    const toggle = document.createElement("label");
    toggle.className = "experiment-toggle";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = clock.labels;
    box.onchange = () => {
      clock.labels = box.checked;
      caption.hidden = !box.checked;
    };
    caption.hidden = !clock.labels;
    toggle.append(box, " Labels");
    element.append(caption, toggle);
    let fiber: ReturnType<typeof render> | null = null;
    let live = true;
    void loadStructure(complexUrl, "Trypsin–BPTI (2PTC)").then((data) => {
      if (live) fiber = render(use(Root, { host, data, clock }));
    });
    return () => {
      live = false;
      if (fiber) unmount(fiber);
      caption.remove();
      toggle.remove();
    };
  },
};
