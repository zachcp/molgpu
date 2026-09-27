// Compatibility barrel for the package's domain-specific type modules.
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
  Instances,
  Links,
  Residues,
  StructureData,
  StructureInput,
  Topology,
  ViewPolicy,
} from "./structure-types.ts";
export type { SecondaryStructureTrace, Trace } from "./trace-types.ts";
export type {
  VolumeData,
  VolumeGrid,
  VolumeInput,
  VolumeLevel,
  VolumeStats,
} from "./volume-types.ts";
export type {
  FrameSource,
  TrajectoryData,
  TrajectoryFrame,
  TrajectoryInput,
  TrajectoryTimeUnit,
} from "./trajectory-types.ts";
