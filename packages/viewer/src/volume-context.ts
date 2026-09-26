import { type LiveContext, makeContext, useContext } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { VolumeData } from "@molgpu/table";

/** The nearest `<Volume>`: its data and the shared GPU copy of its samples. */
export interface VolumeContextValue {
  readonly volume: VolumeData;
  /** Scalar samples, x-fastest, as an f32 storage source. */
  readonly source: StorageSource;
}

export const VolumeContext: LiveContext<VolumeContextValue | undefined> =
  makeContext<VolumeContextValue | undefined>(undefined, "VolumeContext");

/** Read the nearest `<Volume>`; throws without one. */
export function useVolume(): VolumeContextValue {
  const value = useContext(VolumeContext);
  if (!value) throw new Error("useVolume() requires a <Volume> ancestor");
  return value;
}
