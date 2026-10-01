import {
  all,
  resolve,
  type Selection,
  type SelectionView,
  toAtoms,
} from "@molgpu/select";
import type { StructureData } from "@molgpu/table";
import type { SelectionInput } from "../types.ts";

export type SelectionResolution =
  | { readonly status: "pending" }
  | { readonly status: "ready"; readonly selection: Selection }
  | { readonly status: "error"; readonly error: Error };

export const DEFAULT_SELECTION_VIEW: SelectionView = Object.freeze({
  model: "first",
  altloc: "primary",
});
const DEFAULT_QUERY = all();

/** Catch only molecular selection validation/evaluation, never rendering. */
export function resolveSelectionInput(
  input: SelectionInput | undefined,
  root: StructureData,
  data: StructureData | null,
  view: SelectionView = DEFAULT_SELECTION_VIEW,
  who = "Selection",
): SelectionResolution {
  try {
    if (input && "indices" in input) {
      if (
        input.dataset !== root.identity || input.domain !== "atom" ||
        input.deps.topology !== root.revision.topology
      ) {
        throw new TypeError(
          "foreign, non-atom or topology-stale resolved selection",
        );
      }
      return { status: "ready", selection: input };
    }
    if (!data) return { status: "pending" };
    if (
      data.identity !== root.identity ||
      data.revision.topology !== root.revision.topology
    ) {
      throw new TypeError(
        "snapshot does not belong to the nearest structure topology",
      );
    }
    return {
      status: "ready",
      selection: toAtoms(resolve(input ?? DEFAULT_QUERY, data, { view }), data),
    };
  } catch (cause) {
    return {
      status: "error",
      error: new TypeError(`${who} selection failed`, { cause }),
    };
  }
}
