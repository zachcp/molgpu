/** Type-only crj.9 comparisons against the installed use.gpu 0.20.0 types. */
import type { LiveElement } from "@use-gpu/live";
import type { PBRMaterialProps } from "@use-gpu/workbench";
import type { Selection, SelectionQuery } from "@molgpu/select";
import type { MaterialSpec, ViewerElement } from "@molgpu/viewer";

// Current erasure accepts both of these invalid renderer/material values.
export const erasedElement: ViewerElement = { arbitrary: true };
export const erasedMaterial: MaterialSpec = { type: "pbr", roughnes: "bad" };
// @ts-expect-error Native LiveElement rejects arbitrary objects.
export const nativeElement: LiveElement = { arbitrary: true };
// @ts-expect-error Native material props catch the misspelled property.
export const nativeMaterial: PBRMaterialProps = { roughnes: "bad" };

// Proposed narrow owned facade: ordinary constants, native wrappers for shaders.
type ProposedMaterial =
  | {
    type?: "pbr";
    metalness?: number;
    roughness?: number;
    albedo?: readonly number[];
    emissive?: readonly number[];
  }
  | { type: "basic"; color?: readonly number[] }
  | { type: "normal" }
  | ((children: LiveElement) => LiveElement);

export const matte: ProposedMaterial = { type: "pbr", roughness: 0.6 };
// @ts-expect-error No unrestricted Record erasure in the proposed facade.
export const typo: ProposedMaterial = { type: "pbr", roughnes: 0.6 };
// @ts-expect-error Scalar material constants have concrete types.
export const wrongScalar: ProposedMaterial = { type: "pbr", roughness: "bad" };
// @ts-expect-error Material discriminator excludes PBR props on normal.
export const wrongKind: ProposedMaterial = { type: "normal", roughness: 0.6 };

/** Proposed public prop alias; omitted/null keep the existing default view. */
export type ProposedSelectionInput = SelectionQuery | Selection | null;
/** Internal result only: pending can never be passed as a null/default select. */
export type ProposedSelectionResolution =
  | { status: "pending" }
  | { status: "ready"; selection: Selection };
