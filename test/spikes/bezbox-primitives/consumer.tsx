/** Compile-only public acceptance: molecular props remain ordinary and explicit. */
import { React } from "@use-gpu/live";
import type { StructureData, TrajectoryData, VolumeData } from "@molgpu/table";
import {
  FieldArrows,
  Spacefill,
  Structure,
  Trajectory,
  Volume,
  VolumeSlice,
} from "@molgpu/viewer";
import type {
  TrajectoryProps,
  ViewerElement,
  VolumeProps,
} from "@molgpu/viewer";

void React;

export function example(
  structure: StructureData,
  trajectory: TrajectoryData,
  volume: VolumeData,
  frame: number,
): ViewerElement {
  return (
    <Volume data={volume}>
      <VolumeSlice />
      <FieldArrows width={2} spacing={3} />
      <Structure data={structure}>
        <Trajectory data={trajectory} frame={frame}>
          <Spacefill />
        </Trajectory>
      </Structure>
    </Volume>
  );
}

export function exclusiveSources(
  data: TrajectoryData,
  volume: VolumeData,
): void {
  // A flat trait intersection must not accidentally erase either public union.
  // @ts-expect-error data and src are mutually exclusive
  const invalidTrajectory: TrajectoryProps = { data, src: "a.dcd", frame: 0 };
  // @ts-expect-error loaded volumes do not accept loading presentation props
  const invalidVolume: VolumeProps = { data: volume, loading: null };
  void invalidTrajectory;
  void invalidVolume;
}
