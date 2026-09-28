// Compatibility barrel for the package's domain-specific type modules.
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
