/**
 * Import structures, trajectories, selection expressions and volume maps into
 * plain molecular data. Parsers load on demand; import failures use `IoError`.
 * Coordinates are in Ångström. See the README for format and transport examples.
 *
 * @module
 */
export type { FileInput } from "./input.ts";
export type {
  ByteSource,
  OpenTrajectoryOptions,
  PqrApplyReport,
  PqrStructureReport,
  SurfaceField,
  SurfaceFieldAtoms,
  SurfaceFieldOptions,
} from "./types.ts";
export { IoError } from "./error.ts";
export type { IoErrorCode, IoFormat } from "./error.ts";
export { structureFromBcif } from "./bcif.ts";
export { molecularSurfaceField } from "./molecular-surface.ts";
export { volumeFromCcp4 } from "./ccp4.ts";
export { applyPqr, structureFromPqr } from "./pqr.ts";
export { openTrajectory } from "./trajectory.ts";
export {
  parseSelection,
  type SelectionExpr,
  type SelectionLanguage,
} from "./selection.ts";
