import { type LiveContext, makeContext } from "@use-gpu/live";
import type { StructureData } from "@molgpu/table";

export interface AttributeSnapshot {
  readonly data: StructureData;
  readonly generation: number;
}
export interface SnapshotProvider {
  readonly snapshot: AttributeSnapshot | null;
  readonly subscribe: (maxHz: number, onPause: boolean) => () => void;
}
export type SnapshotMap = Readonly<Record<string, SnapshotProvider>>;
export const AttributeSnapshotContext: LiveContext<SnapshotMap | undefined> =
  makeContext<SnapshotMap | undefined>(undefined, "AttributeSnapshotContext");
export const EMPTY_ATTRIBUTE_SNAPSHOTS: SnapshotMap = Object.freeze({});
