// Pure molecular values. Arrays are packed CPU columns and immutable by contract.
// No renderer, parser, or global platform API is required by this module.
export type {
  Atoms,
  AttributeColumn,
  AttributeColumnInput,
  AttributeDomain,
  AttributeProvenance,
  AttributeValues,
  BondPolicy,
  Bonds,
  Chains,
  FrameSource,
  Instances,
  Links,
  Residues,
  SecondaryStructureTrace,
  StructureData,
  StructureInput,
  Topology,
  Trace,
  TrajectoryData,
  TrajectoryFrame,
  TrajectoryInput,
  TrajectoryTimeUnit,
  ViewPolicy,
  VolumeData,
  VolumeGrid,
  VolumeInput,
  VolumeLevel,
  VolumeStats,
} from "./types.ts";
export { activeAtoms, coordinateBounds, residueKey } from "./structure-view.ts";
export {
  atomRadii,
  BOND_FLAGS,
  bondTopology,
  elementRadius,
} from "./bond-topology.ts";
export {
  attributeColumn,
  attributeNames,
  withAttributes,
} from "./attributes.ts";
export { createStructure, withPositions } from "./structure.ts";
export { traceTable } from "./trace.ts";
export { secondaryStructureTrace } from "./secondary-structure.ts";
export { SS_CODES, ssKind } from "./ss-codes.ts";
export { dssp, type DsspOptions, withSecondaryStructure } from "./dssp.ts";
export { type SpatialGrid, spatialGrid } from "./spatial-grid.ts";
export {
  createVolume,
  createVolumeGrid,
  MAX_VOLUME_SAMPLES,
  sampleVolume,
  sampleVolumeGradient,
  volumeComponent,
  volumeGradientStep,
  volumeIndexToWorld,
  volumeInverseTransform,
  volumeLevel,
  volumeWorldToIndex,
} from "./volume.ts";
export { createTrajectory, validateTrajectory } from "./trajectory.ts";
