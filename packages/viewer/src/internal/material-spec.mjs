/** Material `type` names a representation's `material` prop accepts. */
export const materialTypes = Object.freeze(['pbr', 'basic', 'normal', 'flat', 'lit']);

/**
 * Resolve a representation's `material` prop to an instruction, without touching
 * any @use-gpu/workbench component — so this is unit-testable under Node, where
 * workbench cannot import. `withMaterial` (materials.mjs) maps the result onto
 * the actual material components. Returns one of:
 *   { kind: 'none' }                  — no material; the layer uses the ambient one
 *   { kind: 'wrap', wrap }            — a `(children) => element` escape-hatch function
 *   { kind: 'material', type, props } — a spec object with a validated `type`
 */
export const resolveMaterial = (material) => {
  if (material == null) return { kind: 'none' };
  if (typeof material === 'function') return { kind: 'wrap', wrap: material };
  if (typeof material !== 'object' || Array.isArray(material)) {
    throw new TypeError('material must be a spec object, a wrapper function, or null');
  }
  const { type = 'pbr', ...props } = material;
  if (!materialTypes.includes(type)) {
    throw new TypeError(`Unknown material type '${type}'; expected one of: ${materialTypes.join(', ')}`);
  }
  return { kind: 'material', type, props };
};
