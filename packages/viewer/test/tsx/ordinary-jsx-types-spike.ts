/** Public element/material regression assertions; query resolution remains a spike. */
import { use } from "@use-gpu/live";
import { PBRMaterial } from "@use-gpu/workbench";
import type { LiveElement } from "@use-gpu/live";
import type { PBRMaterialProps } from "@use-gpu/workbench";
import type { Selection, SelectionQuery } from "@molgpu/select";
import { Spacefill } from "@molgpu/viewer";
import type {
  MaterialSpec,
  StructureProps,
  ViewerComponent,
  ViewerElement,
} from "@molgpu/viewer";

// @ts-expect-error ViewerElement rejects arbitrary objects.
export const erasedElement: ViewerElement = { arbitrary: true };
// @ts-expect-error MaterialSpec rejects misspelled properties.
export const erasedMaterial: MaterialSpec = { type: "pbr", roughnes: "bad" };
// @ts-expect-error Native LiveElement rejects arbitrary objects.
export const nativeElement: LiveElement = { arbitrary: true };
// @ts-expect-error Native material props catch the misspelled property.
export const nativeMaterial: PBRMaterialProps = { roughnes: "bad" };

export const matte: MaterialSpec = { type: "pbr", roughness: 0.6 };
export const tint: MaterialSpec = { type: "basic", color: [1, 0.5, 0.5, 1] };
export const nativeWrapper: MaterialSpec = (children) =>
  use(PBRMaterial, { roughness: () => 0.6, children });
export const nativeScene: LiveElement = use(Spacefill, {
  material: nativeWrapper,
});
export const viewerScene: ViewerElement = use(PBRMaterial, {
  children: nativeScene,
});
export const component: ViewerComponent<Parameters<typeof Spacefill>[0]> =
  Spacefill;
// @ts-expect-error No unrestricted Record erasure.
export const typo: MaterialSpec = { type: "pbr", roughnes: 0.6 };
// @ts-expect-error Scalar material constants have concrete types.
export const wrongScalar: MaterialSpec = { type: "pbr", roughness: "bad" };
// @ts-expect-error Material discriminator excludes PBR props on normal.
export const wrongKind: MaterialSpec = { type: "normal", roughness: 0.6 };
// @ts-expect-error Lazy values belong in the wrapper form.
export const lazyConstant: MaterialSpec = { roughness: () => 0.6 };
// @ts-expect-error Viewer components must return scene elements.
export const badComponent: ViewerComponent = () => ({ arbitrary: true });
export const badChildren: StructureProps = {
  src: "molecule.bcif",
  // @ts-expect-error Public children accept scene elements, not arbitrary objects.
  children: { arbitrary: true },
};

/** Proposed public prop alias; omitted/null keep the existing default view. */
export type ProposedSelectionInput = SelectionQuery | Selection | null;
/** Internal result only: pending can never be passed as a null/default select. */
export type ProposedSelectionResolution =
  | { status: "pending" }
  | { status: "ready"; selection: Selection };
