/**
 * Source/playback acceptance (molgpu-sept-s5o.3): see
 * docs/findings/2026-10-01-source-playback-decision.md. Type-checked by
 * `deno task typecheck:components`; the runtime evidence for the combined
 * component is run-trajectory.mjs.
 */
import { React } from "@use-gpu/live";
import { openTrajectory } from "@molgpu/io";
import type { StructureData, TrajectoryData } from "@molgpu/table";
import { Spacefill, Structure, Trajectory } from "@molgpu/viewer";
import type { TrajectoryStatus, ViewerElement } from "@molgpu/viewer";

void React;

// 1. The combined component stays the ordinary form: playback over the
//    nearest structure, with upstream coordinates showing while `src` opens.
export const combined = (
  data: StructureData,
  src: string,
  frame: number,
): ViewerElement => (
  <Structure data={data}>
    <Trajectory src={src} frame={frame}>
      <Spacefill />
    </Trajectory>
  </Structure>
);

// 2. Separation already exists without a new component or hook: the
//    application opens the source (owning its own pending/error UI and
//    retries) and `<Trajectory data>` is playback only.
export const openForPlayback = (
  src: string,
  signal: AbortSignal,
): Promise<TrajectoryData> => openTrajectory(src, { signal });

export const separated = (
  data: StructureData,
  trajectory: TrajectoryData,
  frame: number,
): ViewerElement => (
  <Structure data={data}>
    <Trajectory data={trajectory} frame={frame}>
      <Spacefill />
    </Trajectory>
  </Structure>
);

// 3. Source and frame failures are reported, not thrown, and upstream
//    coordinates keep showing (molgpu-sept-s5o.18).
export const reported = (
  data: StructureData,
  src: string,
  log: (status: TrajectoryStatus) => void,
): ViewerElement => (
  <Structure data={data}>
    <Trajectory
      src={src}
      frame={0}
      onStatus={log}
    >
      <Spacefill />
    </Trajectory>
  </Structure>
);
