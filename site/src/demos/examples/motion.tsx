// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact, useResource } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import {
  byElement,
  bySecondaryStructure,
  colormap,
  curve,
} from "@molgpu/fields";
import { comp, resolve, toAtoms } from "@molgpu/select";
import { frameCurve } from "@molgpu/timeline";
import {
  BallAndStick,
  Bonds,
  Ramachandran,
  type RamachandranPoint,
  Ribbon,
  Spacefill,
  Trajectory,
  Tube,
  useTrajectoryFrame,
} from "@molgpu/viewer";
import motionUrl from "../../../assets/1crn-motion.xtc?url";
import { DynamicsScene } from "../dynamics.tsx";
import type { SceneOptions } from "../options.ts";

// The XTC is a seamless loop (frame 60 would equal frame 0). Playing 59 frame
// steps over the 4 s scrub range ends on frame 59, so the wrap to frame 0 is
// one ordinary step instead of a held last frame and a jump.
const motion = frameCurve({ frames: 59, fps: 59 / 4, loop: true });

/** Mirrors the displayed frame onto the canvas host for the site test. */
const FrameReadout = () => {
  const frame = useTrajectoryFrame()?.frame ?? null;
  useResource(() => {
    const host = document.querySelector<HTMLElement>("#molecule-canvas");
    if (host && frame !== null) host.dataset.frame = frame.toFixed(3);
  }, [frame]);
  return null;
};

// Test hook: the inset's plotted points, published on the canvas host.
const publishRama = (points: readonly RamachandranPoint[]) => {
  const host = document.querySelector<HTMLElement>("#molecule-canvas");
  if (!host) return;
  host.dataset.ramaCount = String(points.length);
  host.dataset.ramaFirst = points.length
    ? `${points[0].residue}:${points[0].phi.toFixed(2)},${
      points[0].psi.toFixed(2)
    }`
    : "";
};

const timelineColor = colormap(curve([[0, 0], [2, 1], [4, 1]]), [[0, [
  0.21,
  0.45,
  0.82,
  1,
]], [1, [0.91, 0.39, 0.23, 1]]]);

/** Motion: the timeline drives frames, coordinate kernels, dynamics or camera. */
export const motionScene = (data: StructureData, options: SceneOptions) => {
  switch (options.motionMode) {
    case "trajectory":
      return (
        <Trajectory src={motionUrl} frame={motion}>
          {options.trajectoryMode === "tube"
            ? <Tube radius={0.48} color={[0.55, 0.85, 0.6, 1]} />
            : <BallAndStick ball={0.28} stick={0.22} color={byElement()} />}
          <FrameReadout />
          {options.ramachandran
            ? (
              <Ramachandran
                corner="bottom-right"
                size={200}
                color={bySecondaryStructure()}
                onPoints={publishRama}
              />
            )
            : null}
        </Trajectory>
      );
    case "wobble":
      return [
        <Spacefill scale={0.36} color={[0.42, 0.72, 0.95, 1]} />,
        <Bonds width={0.18} color={[0.82, 0.85, 0.92, 1]} />,
        <Ribbon color={[0.95, 0.5, 0.28, 1]} opacity={0.65} />,
      ];
    case "elastic":
      return <DynamicsScene data={data} />;
    case "camera":
      return [
        <Spacefill scale={0.55} color={timelineColor} />,
        <BallAndStick
          select={toAtoms(resolve(comp(["CYS"]), data), data)}
          ball={0.26}
          stick={0.2}
        />,
      ];
  }
};
