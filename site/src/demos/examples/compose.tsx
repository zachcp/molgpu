// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import { bySecondaryStructure } from "@molgpu/fields";
import { element, resolve } from "@molgpu/select";
import {
  BallAndStick,
  Cartoon,
  Spacefill,
  Surface,
  Tube,
} from "@molgpu/viewer";
import type { ComposeLayer } from "../registry.ts";
import type { SceneOptions } from "../options.ts";
import { MeasureScene } from "../measure.tsx";

/** Compose: every layer is a public component reading the same structure. */
export const composeScene = (
  data: StructureData,
  layers: readonly ComposeLayer[],
  measure: SceneOptions["measure"],
) => {
  const on = (layer: ComposeLayer) => layers.includes(layer);
  return [
    on("measure") && measure && (
      <MeasureScene data={data} picks={measure.picks} onPick={measure.onPick} />
    ),
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
