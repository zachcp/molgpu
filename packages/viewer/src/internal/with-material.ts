import type { LC } from "@use-gpu/live";
import { use } from "@use-gpu/live";
import { BasicMaterial, NormalMaterial, PBRMaterial } from "@use-gpu/workbench";
import type { MaterialSpec, MaterialType, ViewerElement } from "../types.ts";
import { live, viewer } from "./elements.ts";
import { resolveMaterial } from "./material-spec.ts";

/** Molecules read best matte and non-metallic; upstream defaults to roughness 0.5. */
const MolecularPBR: LC<Record<string, unknown>> = (
  { metalness = 0, roughness = 0.6, ...props },
) => use(PBRMaterial, { metalness, roughness, ...props });

// resolveMaterial has already validated the spec; each material takes its own props.
// deno-lint-ignore no-explicit-any
const MATERIALS: Record<MaterialType, LC<any>> = {
  pbr: MolecularPBR,
  basic: BasicMaterial,
  normal: NormalMaterial,
};

/**
 * Wrap a representation's rendered element in its `material` prop so the
 * `shaded` layers beneath it read that MaterialContext. null/undefined leaves
 * the element on the ambient material; a function is the escape hatch for any
 * upstream material, including custom shader materials.
 */
export function withMaterial(
  material: MaterialSpec | null | undefined,
  element: ViewerElement,
): ViewerElement {
  const resolved = resolveMaterial(material);
  if (resolved.kind === "none") return element;
  if (resolved.kind === "wrap") return resolved.wrap(element);
  return viewer(
    use(MATERIALS[resolved.type], {
      ...resolved.props,
      children: live(element),
    }),
  );
}
