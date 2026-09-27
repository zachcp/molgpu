// Pure molecular values. Arrays are packed CPU columns and immutable by contract.
// No renderer, parser, or global platform API is required by this module.
export type * from "./types.ts";
export {
  activeAtoms,
  atomRadii,
  attributeColumn,
  attributeNames,
  BOND_FLAGS,
  bondTopology,
  coordinateBounds,
  createStructure,
  elementRadius,
  residueKey,
  selectBonds,
  validateStructure,
  withAttributes,
  withPositions,
} from "./structure.ts";
export { traceTable } from "./trace.ts";
export { secondaryStructureTrace } from "./secondary-structure.ts";
export { SS_CODES, ssKind } from "./ss-codes.ts";
export { dssp, type DsspOptions, withSecondaryStructure } from "./dssp.ts";
export {
  type FrameSecondaryStructure,
  frameSecondaryStructure,
} from "./frame-ss.ts";
export { type SpatialGrid, spatialGrid } from "./spatial-grid.ts";
export {
  createVolume,
  createVolumeGrid,
  MAX_VOLUME_SAMPLES,
  sampleVolume,
  sampleVolumeGradient,
  validateVolume,
  volumeComponent,
  volumeGradientStep,
  volumeIndexToWorld,
  volumeInverseTransform,
  volumeLevel,
  volumeWorldToIndex,
} from "./volume.ts";
export {
  createTrajectory,
  frameAtTime,
  trajectoryFromModels,
  validateTrajectory,
  validateTrajectoryFrame,
} from "./trajectory.ts";
