import { type LC, type LiveElement, use } from "@use-gpu/live";
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

/** A representation's props after the gate: diagnostics consumed, and `select`
 * narrowed to the ready selection (null when the caller gave none). */
export type Resolved<P> = Omit<P, "select" | keyof SelectionDiagnostics> & {
  select?: Selection | null;
};

/**
 * Gate `Resolved` behind `select`: pending, failed and empty selections draw
 * nothing, and `Resolved` receives the ready selection plus `extra` props.
 */
export function selected<
  P extends SelectionDiagnostics & { select?: SelectionInput },
  E extends object = Record<never, never>,
>(
  who: string,
  Resolved: LC<Resolved<P> & E>,
  extra?: E,
): (props: P) => LiveElement {
  return (props) =>
    use(SelectionConsumer, {
      input: props.select,
      who,
      onSelectionStatus: props.onSelectionStatus,
      warnEmptySelection: props.warnEmptySelection,
      render: (select: Selection) => {
        const {
          onSelectionStatus: _status,
          warnEmptySelection: _warn,
          ...draw
        } = props;
        return use(
          Resolved,
          {
            ...draw,
            ...extra,
            select: props.select == null ? null : select,
          } as Resolved<P> & E,
        );
      },
    });
}
