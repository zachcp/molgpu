import { type LiveContext, makeContext } from "@use-gpu/live";
import type { ReadbackToken } from "../internal/readback-token.ts";
import type { StructureData } from "@molgpu/table";

/** CPU structure data containing one published attribute and its source-local revision. */
export interface AttributeSnapshot {
  readonly data: StructureData;
  readonly generation: number;
}
export interface SnapshotProvider {
  readonly domain?: import("@molgpu/table").AttributeDomain;
  readonly kind?: "scalar" | "code";
  readonly token?: ReadbackToken;
  readonly error?: unknown;
  readonly snapshot: AttributeSnapshot | null;
  readonly subscribe: (maxHz: number, onPause: boolean) => () => void;
}
export type SnapshotMap = Readonly<Record<string, SnapshotProvider>>;
export const AttributeSnapshotContext: LiveContext<SnapshotMap | undefined> =
  makeContext<SnapshotMap | undefined>(undefined, "AttributeSnapshotContext");
export const EMPTY_ATTRIBUTE_SNAPSHOTS: SnapshotMap = Object.freeze({});
