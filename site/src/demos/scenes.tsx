/** @jsx LiveReact.createElement */
import { React as LiveReact, useResource } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import { byElement, colormap, curve } from "@molgpu/fields";
import { comp, element, resolve, toAtoms, within } from "@molgpu/select";
import { frameCurve } from "@molgpu/timeline";
import {
  BallAndStick,
  Bonds,
  Ribbon,
  Spacefill,
  Surface,
  Trajectory,
  Tube,
  useTrajectoryFrame,
} from "@molgpu/viewer";
import motionUrl from "../../assets/1crn-motion.xtc?url";
import type { DemoId } from "./registry.ts";

// 60 frames at 15 fps: the 0–4 s scrub range plays the loop once.
const motion = frameCurve({ frames: 60, fps: 15, loop: true });

/** Mirrors the displayed frame onto the canvas host for the site test. */
const FrameReadout = () => {
  const frame = useTrajectoryFrame()?.frame ?? null;
  useResource(() => {
    const host = document.querySelector<HTMLElement>("#molecule-canvas");
    if (host && frame !== null) host.dataset.frame = frame.toFixed(3);
  }, [frame]);
  return null;
};

export type SurfaceMode = "opaque" | "glass" | "pumice";
export type MaterialMode = "matte" | "metal" | "basic" | "normal";
export interface SceneOptions {
  readonly surfaceMode: SurfaceMode;
  readonly materialMode: MaterialMode;
}

const timelineColor = colormap(curve([[0, 0], [2, 1], [4, 1]]), [[0, [
  0.21,
  0.45,
  0.82,
  1,
]], [1, [0.91, 0.39, 0.23, 1]]]);

/** Every maintained example stays visible here; each branch is public-API JSX. */
export const renderDemoScene = (
  id: DemoId,
  data: StructureData,
  options: SceneOptions,
) => {
  switch (id) {
    case "scene":
      return [
        <Spacefill scale={0.55} />,
        <BallAndStick ball={0.18} stick={0.24} />,
      ];
    case "select":
      return [
        <Spacefill scale={0.35} color={[0.3, 0.33, 0.4, 1]} />,
        <BallAndStick
          select={resolve(within(5, comp(["CYS"])), data)}
          ball={0.35}
          stick={0.28}
          color={byElement()}
        />,
      ];
    case "lighting":
      return <Spacefill scale={0.55} color={[0.82, 0.82, 0.82, 1]} />;
    case "timeline":
      return [
        <Spacefill scale={0.55} color={timelineColor} />,
        <BallAndStick
          select={toAtoms(resolve(comp(["CYS"]), data), data)}
          ball={0.26}
          stick={0.2}
        />,
      ];
    case "bonds":
      return <Bonds width={0.32} />;
    case "coordinates":
      return [
        <Spacefill scale={0.36} color={[0.42, 0.72, 0.95, 1]} />,
        <Bonds width={0.18} color={[0.82, 0.85, 0.92, 1]} />,
        <Ribbon color={[0.95, 0.5, 0.28, 1]} opacity={0.65} />,
      ];
    case "trajectory":
      return (
        <Trajectory src={motionUrl} frame={motion}>
          <Spacefill scale={0.3} color={[0.42, 0.72, 0.95, 1]} />
          <Ribbon color={[0.95, 0.5, 0.28, 1]} />
          <FrameReadout />
        </Trajectory>
      );
    case "tube":
      return <Tube radius={0.5} color={[0.55, 0.85, 0.6, 1]} />;
    case "ribbon":
      return <Ribbon color={[0.86, 0.55, 0.35, 1]} />;
    case "surface":
      if (options.surfaceMode === "opaque") {
        return <Surface resolution={0.55} color={[0.75, 0.78, 0.86, 1]} />;
      }
      if (options.surfaceMode === "pumice") {
        return (
          <Surface
            probeRadius={0.5}
            resolution={0.4}
            color={[0.52, 0.5, 0.47, 1]}
            material={{ type: "pbr", roughness: 1, metalness: 0 }}
          />
        );
      }
      return [
        <BallAndStick ball={0.22} stick={0.16} color={byElement()} />,
        <Surface
          resolution={0.55}
          color={[0.55, 0.72, 0.98, 1]}
          opacity={0.3}
        />,
      ];
    case "materials": {
      const material = options.materialMode === "metal"
        ? { type: "pbr" as const, roughness: 0.2, metalness: 0.8 }
        : options.materialMode === "basic"
        ? { type: "basic" as const }
        : options.materialMode === "normal"
        ? { type: "normal" as const }
        : { type: "pbr" as const, roughness: 0.85, metalness: 0 };
      return (
        <Spacefill
          scale={0.5}
          color={[0.38, 0.68, 0.92, 1]}
          material={material}
        />
      );
    }
    case "figure":
      return [
        <Ribbon color={[0.86, 0.55, 0.35, 1]} />,
        <Surface
          resolution={0.65}
          color={[0.55, 0.72, 0.98, 1]}
          opacity={0.15}
        />,
        <Spacefill
          select={resolve(element(16), data)}
          scale={0.7}
          color={[0.98, 0.82, 0.2, 1]}
        />,
      ];
  }
};
