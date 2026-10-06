import { coordinateBounds, type StructureData } from "@molgpu/table";
import { comp, resolve, toAtoms } from "@molgpu/select";
import { cameraFor } from "./data.ts";
import type { FigureStage } from "./figure.ts";

export type DemoId = "compose" | "select" | "surface" | "motion" | "volume";
export type StructureId = "1crn" | "1tqn" | "1a4y";

export interface StructureDefinition {
  readonly id: StructureId;
  readonly title: string;
  readonly description: string;
  /** Label for the structure's "site" selection preset. */
  readonly site: string;
  /** PDB2PQR partial charges ship for this structure (charge colour, potential). */
  readonly charges: boolean;
  /** An XTC trajectory ships for this structure. */
  readonly trajectory: boolean;
}

/** Example structures; each loads lazily from the site's data directory. */
export const structures: readonly StructureDefinition[] = [
  {
    id: "1crn",
    title: "Crambin (1CRN)",
    description: "46-residue soluble plant seed protein with three disulfides.",
    site: "Disulfide neighbourhood",
    charges: true,
    trajectory: true,
  },
  {
    id: "1tqn",
    title: "Cytochrome P450 3A4 (1TQN)",
    description:
      "Membrane-associated drug-metabolising enzyme with bound heme.",
    site: "Heme pocket",
    charges: false,
    trajectory: false,
  },
  {
    id: "1a4y",
    title: "Inhibitor complex (1A4Y)",
    description:
      "Ribonuclease inhibitor bound to angiogenin; two copies in the unit.",
    site: "Inhibitor at the angiogenin interface",
    charges: false,
    trajectory: false,
  },
];

export const structureById = (id: string | null): StructureDefinition =>
  structures.find((structure) => structure.id === id) ?? structures[0];
export type MotionMode = "trajectory" | "wobble" | "elastic" | "camera";
export type VolumeMode = "density" | "potential";
export type ComposeLayer =
  | "cartoon"
  | "tube"
  | "sticks"
  | "spacefill"
  | "surface"
  | "sulfur"
  | "measure";

export interface DemoOptions {
  worldLight?: boolean;
  oit?: boolean;
  time?: number;
  postprocess?: boolean;
  coordinates?: boolean;
  figure?: FigureStage;
  picking?: boolean;
  environment?: "none" | "park" | "pisa" | "road" | "field";
  tonemap?: "linear" | "aces" | "hable" | "reinhard";
}

export interface DemoDefinition {
  readonly id: DemoId;
  readonly title: string;
  readonly summary: string;
  readonly fixture: "1crn";
  readonly assertion: string;
  readonly options?: DemoOptions;
}

export const demos: readonly DemoDefinition[] = [
  {
    id: "compose",
    title: "Compose",
    summary:
      "Layer cartoon, tube, sticks, spacefill, a glass surface and a sulfur highlight over one imported structure and one render pass.",
    fixture: "1crn",
    assertion:
      "every layer is a public viewer component reading the same structure",
    options: { oit: true },
  },
  {
    id: "select",
    title: "Select + color",
    summary:
      "Pick atoms with a query (cysteines, their 5 Å neighbourhood, sulfur, everything) and colour them by element or by imported partial charge.",
    fixture: "1crn",
    assertion:
      "the highlighted atoms are a real @molgpu/select result coloured by a field",
    options: { oit: true },
  },
  {
    id: "surface",
    title: "Surface + material",
    summary:
      "A marching-cubes solvent-excluded surface: choose opaque, glass or pumice, colour by atom element, compare shading models and fix the key light to the world.",
    fixture: "1crn",
    assertion:
      "surface geometry is computed from the structure's atom radii and the material reaches the shaded representation",
    options: { oit: true },
  },
  {
    id: "motion",
    title: "Motion",
    summary:
      "Scrub or play time through a 60-frame XTC trajectory, a GPU coordinate wobble, live elastic-network dynamics, or a camera move into the cysteines.",
    fixture: "1crn",
    assertion:
      "the timeline drives the chosen source: streamed frames, coordinate kernels, integrator steps, or the camera",
  },
  {
    id: "volume",
    title: "Volumes",
    summary:
      "Contour a Gaussian density map with a scrubbable slice, or compute the Coulomb potential of 1CRN's shipped charges and trace its field lines.",
    fixture: "1crn",
    assertion:
      "volumes are uploaded or computed once and shared by isosurface, slice, surface colour and field lines",
    options: { oit: true },
  },
];

/** Hashes from the former 16-demo gallery, with the settings that reproduce each. */
export const legacyDemos: Readonly<
  Record<string, { id: DemoId; preset?: DemoPreset }>
> = {
  scene: { id: "compose", preset: { layers: ["spacefill", "sticks"] } },
  bonds: { id: "compose", preset: { layers: ["sticks"] } },
  tube: { id: "compose", preset: { layers: ["tube"] } },
  ribbon: { id: "compose", preset: { layers: ["cartoon"] } },
  figure: {
    id: "compose",
    preset: { layers: ["cartoon", "surface", "sulfur"], figure: true },
  },
  charge: {
    id: "select",
    preset: { selectionMode: "all", fieldMode: "charge" },
  },
  lighting: { id: "surface", preset: { worldLight: true } },
  materials: { id: "surface", preset: { materialMode: "metal" } },
  timeline: { id: "motion", preset: { motionMode: "camera" } },
  coordinates: { id: "motion", preset: { motionMode: "wobble" } },
  trajectory: { id: "motion", preset: { motionMode: "trajectory" } },
  dynamics: { id: "motion", preset: { motionMode: "elastic" } },
  efield: { id: "volume", preset: { volumeMode: "potential" } },
};

export interface DemoPreset {
  layers?: readonly ComposeLayer[];
  /** Compose figure mode (ground plane, shadows, SSAO). */
  figure?: boolean;
  selectionMode?: "site" | "cysteine" | "sulfur" | "all";
  fieldMode?: "element" | "charge";
  worldLight?: boolean;
  materialMode?: "matte" | "metal" | "basic" | "normal";
  motionMode?: MotionMode;
  volumeMode?: VolumeMode;
}

/** Viewer options for a demo; the motion sources differ in tree shape. */
export const demoOptions = (
  demo: DemoDefinition,
  state: {
    motionMode: MotionMode;
    worldLight: boolean;
    layers?: readonly ComposeLayer[];
    environment?: DemoOptions["environment"];
    figure?: DemoOptions["figure"];
    tonemap?: DemoOptions["tonemap"];
  },
): DemoOptions => ({
  ...demo.options,
  ...(demo.id === "compose" && state.figure ? { figure: state.figure } : {}),
  ...(demo.id === "compose" && state.layers?.includes("measure")
    ? { picking: true }
    : {}),
  ...(demo.id === "surface"
    ? {
      worldLight: state.worldLight,
      environment: state.environment ?? "none",
      tonemap: state.tonemap ?? "linear",
    }
    : {}),
  ...(demo.id === "motion" && state.motionMode === "wobble"
    ? { coordinates: true }
    : {}),
  ...(demo.id === "motion" && state.motionMode === "elastic"
    ? { picking: true }
    : {}),
});

/** Demos whose scene is driven by the scrub slider's seconds. */
export const scrubbed = (id: DemoId): boolean => id === "motion";

export const demoById = (id: string | null): DemoDefinition =>
  demos.find((demo) => demo.id === id) ?? demos[0];

/** Resolve a `#demos/<id>` hash, accepting ids from the former gallery. */
export const demoFromRoute = (
  hash: string,
): { id: DemoId; preset?: DemoPreset } => {
  const name = hash.replace(/^#demos\/?/, "");
  const legacy = legacyDemos[name];
  return legacy ?? { id: demoById(name).id };
};
const timelineFocus = new WeakMap<
  StructureData,
  ReturnType<typeof coordinateBounds>
>();
export const demoCamera = (
  data: StructureData,
  id: DemoId,
  state: { motionMode: MotionMode; volumeMode: VolumeMode },
  time = 0,
) => {
  const whole = cameraFor(
    data,
    id === "volume" && state.volumeMode === "potential" ? 2.4 : 1.7,
  );
  if (id !== "motion" || state.motionMode !== "camera") return whole;
  let focus = timelineFocus.get(data);
  if (focus === undefined) {
    const selected = toAtoms(resolve(comp(["CYS"]), data), data);
    focus = coordinateBounds(data, selected.indices);
    timelineFocus.set(data, focus);
  }
  if (!focus) return whole;
  const extent = Math.max(
    ...focus.max.map((value, axis) => value - focus.min[axis]),
  );
  const closeRadius = Math.max(whole.radius * 0.62, extent * 1.25);
  const t = Math.max(0, Math.min(1, time / 4));
  const smooth = t * t * (3 - 2 * t);
  return {
    radius: whole.radius + (closeRadius - whole.radius) * smooth,
    target: whole.target.map((value, axis) =>
      value + (focus.center[axis] - value) * smooth
    ) as [number, number, number],
  };
};
