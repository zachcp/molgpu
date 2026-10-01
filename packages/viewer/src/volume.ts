import { useSourceRequest } from "./internal/source-request.ts";
import type { VolumeData } from "@molgpu/table";
import type { ViewerComponent, VolumeLoader, VolumeProps } from "./types.ts";
import {
  type LC,
  type LiveElement,
  provide,
  use,
  useMemo,
} from "@use-gpu/live";
import {
  type NearestVolume,
  useStableGrid,
  VolumeContext,
} from "./volume-context.ts";

const noop = () => {};
const noSubscription = () => noop;
import { useVolumeSource } from "./internal/volume-buffers.ts";
import { live, viewer } from "./internal/elements.ts";

const defaultLoader: VolumeLoader = async (src, cancelled, signal) => {
  const { volumeFromCcp4 } = await import("@molgpu/io");
  const volume = await volumeFromCcp4(src, { signal });
  return cancelled() ? null : volume;
};

const VolumeProvider: LC<{ volume: VolumeData; children: LiveElement }> = (
  { volume, children },
) => {
  const source = useVolumeSource(volume);
  const grid = useStableGrid(volume);
  const value = useMemo<NearestVolume>(() => {
    const { min, max } = volume.stats;
    return Object.freeze({
      grid,
      source,
      generation: 1,
      range: Object.freeze([min, max > min ? max : min + 1]) as [
        number,
        number,
      ],
      volume,
      snapshot: volume,
      subscribe: noSubscription,
    });
  }, [volume, source, grid]);
  return provide(VolumeContext, value, children);
};

/**
 * Own one scalar volume (standalone, parallel to `<Structure>`): a preloaded
 * `VolumeData`, or a CCP4/MRC `src`. The samples upload once per volume
 * identity to a GPU buffer shared with every other consumer of the same
 * `VolumeData`, released when the last one unmounts. A structure never owns a
 * volume implicitly: representations read one only through this context or an
 * explicit field (`volumeSample`). Loading and error states match `<Structure>`.
 */
export const Volume: ViewerComponent<VolumeProps> = (
  { data, src, loader = defaultLoader, loading = null, error = null, children },
) => {
  if (data !== undefined && src !== undefined) {
    throw new TypeError("<Volume> accepts either data or src, not both");
  }
  if (data === undefined && src === undefined) {
    throw new TypeError("<Volume> requires data or src");
  }
  if (src !== undefined && typeof src !== "string") {
    throw new TypeError("<Volume> src must be a string");
  }
  if (typeof loader !== "function") {
    throw new TypeError("<Volume> loader must be a function");
  }
  const [loaded, failure, pending] = useSourceRequest(
    data === undefined
      ? async (signal: AbortSignal) =>
        await loader(src!, () => signal.aborted, signal)
      : null,
    [data, src, loader],
  );
  if (data !== undefined) {
    return viewer(
      use(VolumeProvider, { volume: data, children: live(children) }),
    );
  }
  // Replacing src marks the request pending again, so the previous volume
  // cannot flash back while its successor is in flight.
  if (pending) return typeof loading === "function" ? loading() : loading;
  if (failure) return typeof error === "function" ? error(failure) : error;
  // A cancelled request resolves to null and must not mount stale content.
  return loaded
    ? viewer(use(VolumeProvider, { volume: loaded, children: live(children) }))
    : null;
};
