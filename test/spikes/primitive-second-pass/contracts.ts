/** Compile-only review example: one explicit caller contract, a derived adapter. */
import type { Field } from "@molgpu/fields";
import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  SelectionDiagnostics,
  SelectionInput,
  Translucency,
  Tube,
  VectorLike,
} from "@molgpu/viewer";

type TubeProps =
  & {
    select?: SelectionInput;
    radius?: number;
    smooth?: number;
    color?: VectorLike | Field;
    sides?: number;
    join?: "tangent" | "bevel" | "miter" | "round";
    shadow?: boolean;
    material?: MaterialSpec;
  }
  & Translucency
  & SelectionDiagnostics;

type ResolvedTubeProps =
  & Omit<TubeProps, "select" | keyof SelectionDiagnostics>
  & { select?: Selection | null };

// Bidirectional assignment checks the proposed caller contract against main.
declare const current: Parameters<typeof Tube>[0];
declare const proposed: TubeProps;
const acceptsCurrent: TubeProps = current;
const acceptsProposed: Parameters<typeof Tube>[0] = proposed;
void acceptsCurrent;
void acceptsProposed;

const defaults: ResolvedTubeProps = { select: null, radius: 0.3 };
void defaults;
declare const query: Exclude<SelectionInput, Selection | null>;
// @ts-expect-error Queries must resolve before entering the draw adapter.
const unresolved: ResolvedTubeProps = { select: query };
// @ts-expect-error Diagnostic props belong at the query boundary.
const diagnostics: ResolvedTubeProps = { warnEmptySelection: true };
// @ts-expect-error Native GPU sources do not belong in ordinary molecular JSX.
const gpuInput: TubeProps = { positions: {} };
void unresolved;
void diagnostics;
void gpuInput;
