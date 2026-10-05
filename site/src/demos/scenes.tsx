// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact, useResource } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import {
  byCharge,
  byElement,
  byPotential,
  bySecondaryStructure,
  colormap,
  curve,
  volumeSample,
} from "@molgpu/fields";
import { all, comp, element, resolve, toAtoms, within } from "@molgpu/select";
import { frameCurve } from "@molgpu/timeline";
import {
  BallAndStick,
  Bonds,
  Cartoon,
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
import type {
  ComposeLayer,
  DemoId,
  MotionMode,
  VolumeMode,
} from "./registry.ts";
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
export type SelectionMode = "near-cysteine" | "cysteine" | "sulfur" | "all";
export type FieldMode = "element" | "charge";
export type TrajectoryMode = "tube" | "ball-and-stick";
export interface SceneOptions {
  readonly layers: readonly ComposeLayer[];
  readonly surfaceMode: SurfaceMode;
  readonly surfaceColorMode: SurfaceColorMode;
  readonly materialMode: MaterialMode;
  readonly selectionMode: SelectionMode;
  readonly fieldMode: FieldMode;
  readonly motionMode: MotionMode;
  readonly trajectoryMode: TrajectoryMode;
  readonly volumeMode: VolumeMode;
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
    : mode === "all"
    ? resolve(all("atom"), data)
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

const materialFor = (mode: MaterialMode) =>
  mode === "metal"
    ? { type: "pbr" as const, roughness: 0.2, metalness: 0.8 }
    : mode === "basic"
    ? { type: "basic" as const }
    : mode === "normal"
    ? { type: "normal" as const }
    : { type: "pbr" as const, roughness: 0.85, metalness: 0 };

const composeScene = (data: StructureData, layers: readonly ComposeLayer[]) => {
  const on = (layer: ComposeLayer) => layers.includes(layer);
  return [
    on("cartoon") && <Cartoon color={bySecondaryStructure()} />,
    on("tube") && <Tube radius={0.5} color={[0.55, 0.85, 0.6, 1]} />,
    on("spacefill") && <Spacefill scale={0.55} color={[0.75, 0.78, 0.86, 1]} />,
    on("sticks") && <BallAndStick ball={0.18} stick={0.24} />,
    on("surface") && (
      <Surface
        resolution={0.65}
        color={[0.68, 0.81, 0.99, 1]}
        opacity={0.15}
      />
    ),
    on("sulfur") && (
      <Spacefill
        select={resolve(element(16), data)}
        scale={0.7}
        color={[0.98, 0.82, 0.2, 1]}
      />
    ),
  ].filter(Boolean);
};

const surfaceScene = (options: SceneOptions) => {
  const color = (neutral: Rgba) =>
    options.surfaceColorMode === "element" ? byElement() : neutral;
  if (options.surfaceMode === "pumice") {
    return (
      <Surface
        probeRadius={0.5}
        resolution={0.4}
        color={color([0.52, 0.5, 0.47, 1])}
        material={{ type: "pbr", roughness: 1, metalness: 0 }}
      />
    );
  }
  const material = materialFor(options.materialMode);
  if (options.surfaceMode === "glass") {
    return [
      <BallAndStick ball={0.22} stick={0.16} color={byElement()} />,
      <Surface
        resolution={0.55}
        color={color([0.55, 0.72, 0.98, 1])}
        opacity={0.3}
        material={material}
      />,
    ];
  }
  return (
    <Surface
      resolution={0.55}
      color={color([0.75, 0.78, 0.86, 1])}
      material={material}
    />
  );
};

const motionScene = (data: StructureData, options: SceneOptions) => {
  switch (options.motionMode) {
    case "trajectory":
      return (
        <Trajectory src={motionUrl} frame={motion}>
          {options.trajectoryMode === "tube"
            ? <Tube radius={0.48} color={[0.55, 0.85, 0.6, 1]} />
            : <BallAndStick ball={0.28} stick={0.22} color={byElement()} />}
          <FrameReadout />
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

const volumeScene = (data: StructureData, options: SceneOptions) => {
  if (options.volumeMode === "potential") {
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
  }
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
};

/** Every maintained example stays visible here; each branch is public-API JSX. */
export const renderDemoScene = (
  id: DemoId,
  data: StructureData,
  options: SceneOptions,
) => {
  switch (id) {
    case "compose":
      return composeScene(data, options.layers);
    case "select": {
      const everything = options.selectionMode === "all";
      const color = options.fieldMode === "charge"
        ? byCharge({ domain: [-0.8, 0.8] })
        : byElement();
      return [
        <Spacefill scale={0.35} color={[0.3, 0.33, 0.4, 1]} />,
        everything ? <Spacefill scale={0.6} color={color} /> : (
          <BallAndStick
            select={selectionFor(data, options.selectionMode)}
            ball={0.35}
            stick={0.28}
            color={color}
          />
        ),
      ];
    }
    case "surface":
      return surfaceScene(options);
    case "motion":
      return motionScene(data, options);
    case "volume":
      return volumeScene(data, options);
  }
};
