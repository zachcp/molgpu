/** Public composition examples for the source organization proposal. */
import { React } from "@use-gpu/live";
import type { StructureData, TrajectoryData, VolumeData } from "@molgpu/table";
import {
  EField,
  Isosurface,
  Spacefill,
  Structure,
  Superpose,
  Trajectory,
  Tube,
  Volume,
  VolumeSlice,
} from "@molgpu/viewer";
import type { ViewerElement } from "@molgpu/viewer";

void React;

// Mount under the application's existing WebGPU scene and render pass.
// The trajectory must be compatible with the supplied structure's rows.
export const movingMolecule = (
  structure: StructureData,
  trajectory: TrajectoryData,
  frame: number,
): ViewerElement => (
  <Structure data={structure}>
    <Trajectory data={trajectory} frame={frame}>
      <Superpose to="first">
        <Spacefill />
        <Tube />
      </Superpose>
    </Trajectory>
  </Structure>
);

// A volume has its own scope and needs no Structure.
export const loadedVolume = (data: VolumeData): ViewerElement => (
  <Volume data={data}>
    <VolumeSlice />
    <Isosurface level={1} />
  </Volume>
);

// Use a structure with the partialCharge attribute populated. EField publishes
// the same volume contract consumed by the loaded-volume representations.
export const computedVolume = (data: StructureData): ViewerElement => (
  <Structure data={data}>
    <Spacefill />
    <EField>
      <VolumeSlice />
      <Isosurface level={1} />
    </EField>
  </Structure>
);
