// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";
import { byCharge, byElement } from "@molgpu/fields";
import {
  all,
  and,
  chain,
  comp,
  element,
  or,
  resolve,
  type SelectionQuery,
  toAtoms,
  within,
} from "@molgpu/select";
import {
  BallAndStick,
  PickingProvider,
  Spacefill,
  usePicking,
} from "@molgpu/viewer";
import type { SceneOptions, SelectionMode } from "../options.ts";
import type { StructureId } from "../registry.ts";

/** Each structure's site of interest, as a reusable query. */
const SITES: Record<StructureId, SelectionQuery> = {
  "1crn": within(5, comp(["CYS"])),
  "1tqn": within(5, comp(["HEM"])),
  // Inhibitor (chain A) atoms within 5 Å of angiogenin (chain B).
  "1a4y": and(chain("A"), within(5, chain("B"))),
  // Archaeal lipids and squalene (the bilayer the crystal kept), plus the
  // protein atoms within 4 Å of retinal.
  "1c3w": or(within(0, comp(["LI1", "SQU"])), within(4, comp(["RET"]))),
};

export const selectionFor = (
  data: StructureData,
  mode: SelectionMode,
  structure: StructureId,
) =>
  mode === "site"
    ? resolve(SITES[structure], data)
    : mode === "cysteine"
    ? toAtoms(resolve(comp(["CYS"]), data), data)
    : mode === "all"
    ? resolve(all("atom"), data)
    : resolve(element(16), data);

/** Report the atom row under each left press to the page. */
const FocusListener = ({ onPick }: { onPick: (row: number) => void }) => {
  usePicking({ onPick: (hit) => hit && onPick(hit.atom) });
  return null;
};

/** Select + color: a resolved query drawn over a dimmed context. */
export const selectScene = (data: StructureData, options: SceneOptions) => {
  const everything = options.selectionMode === "all";
  const color = options.fieldMode === "charge"
    ? byCharge({ domain: [-0.8, 0.8] })
    : byElement();
  const focus = options.onFocusPick;
  // Translucent context, so a buried site (a heme pocket) stays visible. With
  // click-to-focus it is also what a click picks.
  const context = (
    <Spacefill
      scale={0.35}
      color={[0.3, 0.33, 0.4, 1]}
      opacity={0.18}
      pickable={!!focus}
    />
  );
  return [
    focus
      ? (
        <PickingProvider>
          {context}
          <FocusListener onPick={focus} />
        </PickingProvider>
      )
      : context,
    everything ? <Spacefill scale={0.6} color={color} /> : (
      <BallAndStick
        select={selectionFor(data, options.selectionMode, options.structure)}
        ball={0.35}
        stick={0.28}
        color={color}
      />
    ),
  ];
};
