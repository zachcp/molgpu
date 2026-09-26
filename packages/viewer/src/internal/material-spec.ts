import type { MaterialSpec, MaterialType, ViewerElement } from '../types.ts';

/** What a `material` prop asks for, before any material component is touched. */
export type MaterialInstruction =
  | { readonly kind: 'none' }
  | { readonly kind: 'wrap'; readonly wrap: (children: ViewerElement) => ViewerElement }
  | { readonly kind: 'material'; readonly type: MaterialType; readonly props: Record<string, unknown> };

/** Material `type` names a representation's `material` prop accepts. */
export const materialTypes: ReadonlyArray<MaterialType> = Object.freeze(['pbr', 'basic', 'normal', 'flat', 'lit']);

/**
 * Resolve a representation's `material` prop to an instruction, without touching
 * any @use-gpu/workbench component — so this is unit-testable under Node, where
 * workbench cannot import. `withMaterial` (materials.ts) maps the result onto
 * the actual material components. Returns one of:
 *   { kind: 'none' }                  — no material; the layer uses the ambient one
 *   { kind: 'wrap', wrap }            — a `(children) => element` escape-hatch function
 *   { kind: 'material', type, props } — a spec object with a validated `type`
 */
export const resolveMaterial = (material: MaterialSpec | null | undefined): MaterialInstruction => {
  if (material == null) return { kind: 'none' };
  if (typeof material === 'function') return { kind: 'wrap', wrap: material };
  if (typeof material !== 'object' || Array.isArray(material)) {
    throw new TypeError('material must be a spec object, a wrapper function, or null');
  }
  const { type = 'pbr', ...props } = material as { type?: MaterialType } & Record<string, unknown>;
  if (!materialTypes.includes(type)) {
    throw new TypeError(`Unknown material type '${type}'; expected one of: ${materialTypes.join(', ')}`);
  }
  return { kind: 'material', type, props };
};
