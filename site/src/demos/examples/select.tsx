// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import { byCharge, byElement } from "@molgpu/fields";
import { all, comp, element, resolve, toAtoms, within } from "@molgpu/select";
import { BallAndStick, Spacefill } from "@molgpu/viewer";
import type { SceneOptions, SelectionMode } from "../options.ts";

export const selectionFor = (data: StructureData, mode: SelectionMode) =>
  mode === "near-cysteine"
    ? resolve(within(5, comp(["CYS"])), data)
    : mode === "cysteine"
    ? toAtoms(resolve(comp(["CYS"]), data), data)
    : mode === "all"
    ? resolve(all("atom"), data)
    : resolve(element(16), data);

/** Select + color: a resolved query drawn over a dimmed context. */
export const selectScene = (data: StructureData, options: SceneOptions) => {
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
};
