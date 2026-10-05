/**
 * Renderer-free molecular structures, attributes, volumes and trajectories.
 * Constructors validate inputs; returned typed arrays are read-only by contract.
 * Use `withPositions` and `withAttributes` to create revised structure values.
 *
 * @module
 */
export type {
  Atoms,
  AttributeColumn,
  AttributeColumnInput,
  AttributeDomain,
  AttributeProvenance,
  AttributeValues,
  Bonds,
  Chains,
  Instances,
  Links,
  Residues,
  StructureData,
  StructureInput,
  Topology,
} from "./structure-types.ts";
export type { SecondaryStructureTrace, Trace } from "./trace-types.ts";
export type {
  VolumeData,
  VolumeGrid,
  VolumeInput,
  VolumeLevel,
} from "./volume-types.ts";
export type {
  FrameSource,
  TrajectoryData,
  TrajectoryFrame,
  TrajectoryInput,
  TrajectoryTimeUnit,
} from "./trajectory-types.ts";
export {
  atomicNumberForSymbol,
  ELEMENT_SYMBOL,
  elementSymbolForAtomicNumber,
} from "./elements.ts";
export { activeAtoms, coordinateBounds, residueKey } from "./structure-view.ts";
export {
  atomRadii,
  BOND_FLAGS,
  bondTopology,
  elementRadius,
} from "./bond-topology.ts";
export {
  ATTRIBUTE_DOMAINS,
  attributeColumn,
  attributeNames,
  withAttributes,
} from "./attributes.ts";
export { createStructure, withPositions } from "./structure.ts";
export { traceTable } from "./trace.ts";
export { secondaryStructureTrace } from "./secondary-structure.ts";
export { SS_CODES, ssKind } from "./ss-codes.ts";
export { dssp, withSecondaryStructure } from "./dssp.ts";
export {
  backboneDihedrals,
  dihedralAngle,
  PEPTIDE_BREAK_DISTANCE,
} from "./dihedrals.ts";
export type { BackboneDihedrals } from "./dihedrals.ts";
export { spatialGrid } from "./spatial-grid.ts";
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
