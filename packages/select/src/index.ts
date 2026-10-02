/**
 * Renderer-free molecular selection queries and resolved row selections.
 * Build reusable recipes with `element`, `protein`, `within` and other builders,
 * then call `resolve(query, data)`. Set operations accept resolved selections.
 *
 * @module
 */
export type {
  Domain,
  Selection,
  SelectionQuery,
  SelectionView,
} from "./selection.ts";
export type { SelectionExpr } from "./expr.ts";
export { preserveBondGraph } from "./bond-graph.ts";
export {
  all,
  allConformers,
  allModels,
  and,
  attribute,
  chain,
  comp,
  compile,
  count,
  difference,
  element,
  intersect,
  isEmpty,
  isStale,
  ligand,
  model,
  not,
  nucleic,
  or,
  protein,
  residues,
  resolve,
  secondaryStructure,
  supportedSymbols,
  toAtoms,
  toBonds,
  toResidues,
  union,
  water,
  where,
  within,
  withView,
} from "./selection.ts";
