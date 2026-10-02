import { coordinateBounds, type StructureData } from "@molgpu/table";
import { comp, resolve, toAtoms } from "@molgpu/select";
import { cameraFor } from "./data.ts";

export type DemoId =
  | "scene"
  | "select"
  | "lighting"
  | "timeline"
  | "bonds"
  | "tube"
  | "ribbon"
  | "surface"
  | "materials"
  | "figure"
  | "coordinates"
  | "trajectory"
  | "volume"
  | "charge"
  | "efield"
  | "dynamics";
export interface DemoDefinition {
  readonly id: DemoId;
  readonly title: string;
  readonly summary: string;
  readonly fixture: "1crn";
  readonly assertion: string;
  readonly options?: {
    worldLight?: boolean;
    oit?: boolean;
    time?: number;
    postprocess?: boolean;
    coordinates?: boolean;
    lightFigure?: boolean;
    picking?: boolean;
  };
}

export const demos: readonly DemoDefinition[] = [
  {
    id: "scene",
    title: "Composed scene",
    summary:
      "Spacefill and ball-and-stick share one imported 1CRN structure and render pass.",
    fixture: "1crn",
    assertion:
      "both representations are composed from public viewer components",
  },
  {
    id: "select",
    title: "Selections + fields",
    summary:
      "Choose cysteine residues, their 5 Å neighborhood, or sulfur atoms and color the result by element.",
    fixture: "1crn",
    assertion: "the highlighted neighbourhood is a real @molgpu/select result",
  },
  {
    id: "lighting",
    title: "World-fixed lighting",
    summary:
      "Orbit the imported 1CRN structure while the directional key light remains world-fixed.",
    fixture: "1crn",
    assertion: "the scene uses a world-space directional light",
    options: { worldLight: true },
  },
  {
    id: "timeline",
    title: "Controlled timeline",
    summary:
      "Scrub a four-second color and camera move from all of 1CRN toward its cysteine residues.",
    fixture: "1crn",
    assertion:
      "timeline time controls color and selection-derived camera framing",
  },
  {
    id: "bonds",
    title: "Bond topology",
    summary:
      "Covalent sticks are inferred from the imported 1CRN atom topology.",
    fixture: "1crn",
    assertion: "bond representation reads the structure topology",
  },
  {
    id: "tube",
    title: "Backbone tube",
    summary: "The polymer trace is GPU-extruded into a shaded tube.",
    fixture: "1crn",
    assertion: "tube is constructed from the real 1CRN backbone",
  },
  {
    id: "ribbon",
    title: "Secondary-structure ribbon",
    summary:
      "The annotated 1CRN fixture supplies the secondary structure of a protein cartoon.",
    fixture: "1crn",
    assertion: "ribbon receives real imported secondary structure",
  },
  {
    id: "surface",
    title: "Solvent-excluded surface",
    summary:
      "The full 1CRN solvent-excluded surface is extracted with marching cubes; compare appearance and atom-derived color.",
    fixture: "1crn",
    assertion: "surface geometry is computed from 1CRN atom radii",
    options: { oit: true },
  },
  {
    id: "materials",
    title: "Materials",
    summary:
      "Compare matte PBR, metal PBR, unlit basic, and normal-debug shading on one fixed molecular surface.",
    fixture: "1crn",
    assertion:
      "the public material specification reaches the shaded representation",
    options: { oit: true },
  },
  {
    id: "coordinates",
    title: "Coordinate stream",
    summary:
      "Scrub a GPU wobble through two coordinate providers. Atoms and bonds move live; the ribbon follows a throttled snapshot and focus follows GPU bounds.",
    fixture: "1crn",
    assertion:
      "the provider chain updates live geometry, snapshot geometry, and camera focus",
    options: { coordinates: true },
  },
  {
    id: "trajectory",
    title: "Trajectory playback",
    summary:
      "Scrub a 60-frame XTC trajectory of 1CRN and switch between a snapshot-following tube and live ball-and-stick.",
    fixture: "1crn",
    assertion:
      "the timeline seeks trajectory frames that stream into the coordinate stream",
  },
  {
    id: "volume",
    title: "Density volume",
    summary:
      "A Gaussian density map built from 1CRN is contoured as a glass isosurface, cut by a scrubbable slice, and sampled at every atom to colour packing.",
    fixture: "1crn",
    assertion:
      "the isosurface, slice, and atom colours share one uploaded VolumeData",
    options: { oit: true },
  },
  {
    id: "charge",
    title: "Partial charge",
    summary:
      "PDB2PQR's AMBER charges for 1CRN are applied to the heavy-atom structure, folding each hydrogen onto its atom, and coloured on Mol*'s red-white-blue charge scale.",
    fixture: "1crn",
    assertion:
      "imported partial charges colour atoms through a field, with the charge column uploaded once",
  },
  {
    id: "efield",
    title: "Electrostatic potential",
    summary:
      "Explore the Coulomb potential of 1CRN's PQR charges with adjustable grid spacing, field-line density, and path distance.",
    fixture: "1crn",
    assertion:
      "a computed Volume colours the surface and seeds field lines without a CPU round trip",
    options: { oit: true },
  },
  {
    id: "dynamics",
    title: "Elastic network dynamics",
    summary:
      "Langevin dynamics of 1CRN's CA elastic network, recorded every 10 steps: scrub back and forth through the run, and press Play then right-drag an atom to tug it.",
    fixture: "1crn",
    assertion:
      "the timeline drives the integrator step and checkpoints make the run scrubbable",
    options: { picking: true },
  },
  {
    id: "figure",
    title: "Feature composition",
    summary:
      "Ribbon, surface, selected sulfur sites, material, and postprocessing compose one explanatory molecular figure.",
    fixture: "1crn",
    assertion:
      "multiple maintained public representations share one 1CRN scene",
    options: { oit: true, postprocess: true, lightFigure: true },
  },
];

export const demoById = (id: string | null): DemoDefinition =>
  demos.find((demo) => demo.id === id) ?? demos[0];
const timelineFocus = new WeakMap<
  StructureData,
  ReturnType<typeof coordinateBounds>
>();
export const demoCamera = (data: StructureData, id: DemoId, time = 0) => {
  const whole = cameraFor(
    data,
    id === "lighting" ? 2.2 : id === "efield" ? 2.4 : 1.7,
  );
  if (id !== "timeline") return whole;
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
