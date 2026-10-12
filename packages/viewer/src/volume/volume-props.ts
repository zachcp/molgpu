// Caller-facing source/presentation contracts. @molgpu/table validates grid
// dimensions, units, affine and samples; volume-buffers owns shared scalar GPU
// storage. NearestVolume separately publishes live samples and CPU snapshots.
// These source unions do not describe an attribute layout or publication state.
import type { VolumeData } from "@molgpu/table";
import type { ViewerElement } from "../types.ts";

/** Load with a request signal; replacement/unmount aborts it and suppresses stale results. */
export type VolumeLoader = (
  src: string,
  cancelled: () => boolean,
  signal?: AbortSignal,
) => VolumeData | null | Promise<VolumeData | null>;

/**
 * `<Volume>` props: exactly one of `data` (a preloaded `VolumeData`) or `src`
 * (loaded with `loader`, by default fetch + CCP4/MRC through @molgpu/io).
 */
export type VolumeProps =
  | {
    children?: ViewerElement;
    data: VolumeData;
    src?: undefined;
    loader?: undefined;
    loading?: undefined;
    error?: undefined;
  }
  | {
    children?: ViewerElement;
    src: string;
    data?: undefined;
    /** Its identity is a reload dependency alongside `src`. */
    loader?: VolumeLoader;
    loading?: ViewerElement | (() => ViewerElement);
    error?: ViewerElement | ((failure: unknown) => ViewerElement);
  };
