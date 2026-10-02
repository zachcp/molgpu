// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact, useResource } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import {
  byCharge,
  byElement,
  byPotential,
  colormap,
  curve,
  volumeSample,
} from "@molgpu/fields";
import { comp, element, resolve, toAtoms, within } from "@molgpu/select";
import { frameCurve } from "@molgpu/timeline";
import {
  BallAndStick,
  Bonds,
  EField,
  FieldLines,
  Isosurface,
  Ribbon,
  Spacefill,
  Surface,
  Trajectory,
  Tube,
  useTrajectoryFrame,
  Volume,
  VolumeSlice,
} from "@molgpu/viewer";
import motionUrl from "../../assets/1crn-motion.xtc?url";
import { densityMapFor } from "./data.ts";
import type { DemoId } from "./registry.ts";
import { DynamicsScene } from "./dynamics.tsx";

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
export type SurfaceColorMode = "neutral" | "element";
export type MaterialMode = "matte" | "metal" | "basic" | "normal";
export type SelectionMode = "near-cysteine" | "cysteine" | "sulfur";
export type TrajectoryMode = "tube" | "ball-and-stick";
export interface SceneOptions {
  readonly surfaceMode: SurfaceMode;
  readonly surfaceColorMode: SurfaceColorMode;
  readonly materialMode: MaterialMode;
  readonly selectionMode: SelectionMode;
  readonly trajectoryMode: TrajectoryMode;
  readonly efieldSpacing: number;
  readonly seedSpacing: number;
  readonly lineDistance: number;
  /** Fractional k (third-axis) grid index of the volume slice. */
  readonly sliceIndex: number;
  /** Isosurface level in sigma above the map mean. */
  readonly isoSigma: number;
}

export const selectionFor = (data: StructureData, mode: SelectionMode) =>
  mode === "near-cysteine"
    ? resolve(within(5, comp(["CYS"])), data)
    : mode === "cysteine"
    ? toAtoms(resolve(comp(["CYS"]), data), data)
    : resolve(element(16), data);

type Rgba = readonly [number, number, number, number];
const DENSITY_STOPS: ReadonlyArray<readonly [number, Rgba]> = [
  [0, [0.05, 0.08, 0.2, 0.9]],
  [0.35, [0.18, 0.45, 0.78, 1]],
  [0.7, [0.95, 0.72, 0.3, 1]],
  [1, [1, 0.96, 0.85, 1]],
];

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
        <Spacefill
          scale={0.35}
          color={[0.3, 0.33, 0.4, 1]}
        />,
        <BallAndStick
          select={selectionFor(data, options.selectionMode)}
          ball={0.35}
          stick={0.28}
          color={byElement()}
        />,
      ];
    case "lighting":
      return <Spacefill scale={0.55} color={[0.82, 0.82, 0.82, 1]} />;
    case "timeline":
      return [
        <Spacefill
          scale={0.55}
          color={timelineColor}
        />,
        <BallAndStick
          select={toAtoms(resolve(comp(["CYS"]), data), data)}
          ball={0.26}
          stick={0.2}
        />,
      ];
    case "bonds":
      return [
        <Spacefill scale={0.13} color={[0.55, 0.72, 0.9, 1]} />,
        <Bonds width={0.55} color={[0.98, 0.82, 0.45, 1]} />,
      ];
    case "coordinates":
      return [
        <Spacefill
          scale={0.36}
          color={[0.42, 0.72, 0.95, 1]}
        />,
        <Bonds
          width={0.18}
          color={[0.82, 0.85, 0.92, 1]}
        />,
        <Ribbon
          color={[0.95, 0.5, 0.28, 1]}
          opacity={0.65}
        />,
      ];
    case "trajectory":
      return (
        <Trajectory src={motionUrl} frame={motion}>
          {options.trajectoryMode === "tube"
            ? <Tube radius={0.48} color={[0.55, 0.85, 0.6, 1]} />
            : <BallAndStick ball={0.28} stick={0.22} color={byElement()} />}
          <FrameReadout />
        </Trajectory>
      );
    case "tube":
      return <Tube radius={0.5} color={[0.55, 0.85, 0.6, 1]} />;
    case "ribbon":
      return (
        <Ribbon color={[0.97, 0.66, 0.38, 1]} material={{ type: "basic" }} />
      );
    case "surface":
      if (options.surfaceMode === "opaque") {
        return (
          <Surface
            resolution={0.55}
            color={options.surfaceColorMode === "element"
              ? byElement()
              : [0.75, 0.78, 0.86, 1]}
          />
        );
      }
      if (options.surfaceMode === "pumice") {
        return (
          <Surface
            probeRadius={0.5}
            resolution={0.4}
            color={options.surfaceColorMode === "element"
              ? byElement()
              : [0.52, 0.5, 0.47, 1]}
            material={{ type: "pbr", roughness: 1, metalness: 0 }}
          />
        );
      }
      return [
        <BallAndStick
          ball={0.22}
          stick={0.16}
          color={byElement()}
        />,
        <Surface
          resolution={0.55}
          color={options.surfaceColorMode === "element"
            ? byElement()
            : [0.55, 0.72, 0.98, 1]}
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
        <Surface
          resolution={0.55}
          color={[0.67, 0.75, 0.84, 1]}
          material={material}
        />
      );
    }
    case "volume": {
      const map = densityMapFor(data);
      const { max } = map.stats;
      return [
        <Volume data={map}>
          <Isosurface
            level={{ sigma: options.isoSigma }}
            color={[0.55, 0.72, 0.98, 1]}
            opacity={0.25}
          />
          <VolumeSlice
            plane={{ axis: 2, index: options.sliceIndex }}
            range={[0, max]}
            stops={DENSITY_STOPS}
          />
        </Volume>,
        <Spacefill
          scale={0.3}
          color={colormap(volumeSample(map), [
            [1.5, [0.25, 0.55, 0.95, 1]],
            [max * 0.6, [0.98, 0.45, 0.25, 1]],
          ])}
        />,
      ];
    }
    case "charge":
      return (
        <Spacefill
          scale={0.6}
          color={byCharge({ domain: [-0.8, 0.8] })}
        />
      );
    case "efield":
      // Coulomb potential (ε = 4r, kT/e) of the PQR charges on a chosen grid,
      // read 1.4 Å off the surface; field lines trace E between the charges.
      return (
        <EField spacing={options.efieldSpacing} padding={14}>
          <Surface color={byPotential({ range: 5 })} opacity={0.85} />
          <FieldLines
            seeds={{ spacing: options.seedSpacing }}
            step={0.35}
            steps={Math.ceil(options.lineDistance / 0.35)}
            minField={0.025}
            color={[1, 1, 1, 0.8]}
            width={1.5}
          />
        </EField>
      );
    case "dynamics":
      return <DynamicsScene data={data} />;
    case "figure":
      return [
        <Ribbon color={[0.98, 0.73, 0.39, 1]} material={{ type: "basic" }} />,
        <Surface
          resolution={0.65}
          color={[0.68, 0.81, 0.99, 1]}
          opacity={0.12}
        />,
        <Spacefill
          select={resolve(element(16), data)}
          scale={0.7}
          color={[0.98, 0.82, 0.2, 1]}
        />,
      ];
  }
};
