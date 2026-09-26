import type { StructureData } from "@molgpu/table";
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
  | "volume";
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
      "A resolved 1CRN spatial selection is coloured through the public element field.",
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
      "The explicit seconds clock drives the imported 1CRN scene through overview, colour, and focus beats.",
    fixture: "1crn",
    assertion:
      "timeline beats are declared rather than driven by wall-clock time",
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
      "The annotated 1CRN fixture supplies helix, sheet, and coil widths.",
    fixture: "1crn",
    assertion: "ribbon receives real imported secondary structure",
  },
  {
    id: "surface",
    title: "Solvent-excluded surface",
    summary:
      "Switch between opaque, glass, and pumice material variants of the 1CRN solvent-excluded surface.",
    fixture: "1crn",
    assertion: "surface geometry is computed from 1CRN atom radii",
    options: { oit: true },
  },
  {
    id: "materials",
    title: "Materials",
    summary:
      "The same imported molecular geometry can use matte PBR, metal PBR, unlit basic, or normal-debug shading.",
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
    id: "figure",
    title: "Feature composition",
    summary:
      "Ribbon, surface, selected sulfur sites, material, and postprocessing compose one explanatory molecular figure.",
    fixture: "1crn",
    assertion:
      "multiple maintained public representations share one 1CRN scene",
    options: { oit: true, postprocess: true },
  },
];

export const demoById = (id: string | null): DemoDefinition =>
  demos.find((demo) => demo.id === id) ?? demos[0];
export const demoCamera = (data: StructureData, id: DemoId) =>
  cameraFor(data, id === "lighting" ? 2.2 : 1.7);
