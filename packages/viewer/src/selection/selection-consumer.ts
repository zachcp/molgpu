import type { LC, LiveElement } from "@use-gpu/live";
import type { Selection } from "@molgpu/select";
import type { SelectionDiagnostics, SelectionInput } from "../types.ts";
import { useSelectionInput } from "./use-selection-input.ts";

/** Molecular membership gate. Pending/error/empty never become a default draw. */
export const SelectionConsumer: LC<
  SelectionDiagnostics & {
    input?: SelectionInput;
    who: string;
    render: (selection: Selection) => LiveElement;
  }
> = ({ input, who, render, ...diagnostics }) => {
  const result = useSelectionInput(input, who, "select", diagnostics);
  return result.status === "ready" && result.selection.indices.length
    ? render(result.selection)
    : null;
};
