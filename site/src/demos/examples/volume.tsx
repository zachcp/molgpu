// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import { byElement, byPotential } from "@molgpu/fields";
import {
  BallAndStick,
  EField,
  FieldLines,
  Isosurface,
  Surface,
  Volume,
  VolumeSlice,
} from "@molgpu/viewer";
import { densityMapFor } from "../data.ts";
import type { SceneOptions } from "../options.ts";

type Rgba = readonly [number, number, number, number];
const DENSITY_STOPS: ReadonlyArray<readonly [number, Rgba]> = [
  [0, [0.05, 0.08, 0.2, 0.9]],
  [0.35, [0.18, 0.45, 0.78, 1]],
  [0.7, [0.95, 0.72, 0.3, 1]],
  [1, [1, 0.96, 0.85, 1]],
];

/** Volumes: an uploaded density map, or a potential computed from charges. */
export const volumeScene = (data: StructureData, options: SceneOptions) => {
  if (options.volumeMode === "potential") {
    // Coulomb potential (ε = 4r, kT/e) of the PQR charges on a chosen grid,
    // read 1.4 Å off the surface; field lines trace E between the charges.
    return (
      <EField spacing={options.efieldSpacing} padding={14}>
        <Surface
          color={byPotential({ range: 5 })}
          opacity={0.85}
          mode="oit"
        />
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
        mode="oit"
      />
      <VolumeSlice
        plane={{ axis: 2, index: options.sliceIndex }}
        range={[0, max]}
        stops={DENSITY_STOPS}
      />
    </Volume>,
    // Element-coloured sticks read inside the translucent contour and stay
    // distinct from the slice's density palette.
    <BallAndStick ball={0.2} stick={0.14} color={byElement()} />,
  ];
};
