import {
  type LC,
  type LiveElement,
  use,
  useMemo,
  useResource,
} from "@use-gpu/live";
import { RawData } from "@use-gpu/workbench";
import type { StorageSource } from "@use-gpu/core";
import { type ColumnFormat, prepareColumn } from "./columns.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "../internal/instrumentation.ts";

type Render = (source: StorageSource) => LiveElement;

// The source and its buffer are owned by this subtree. Cleanup releases that
// ownership but does not destroy the buffer: a retained draw from a replaced
// representation can still submit it (docs/findings/2026-09-29-gpu-retirement-decision.md),
// so native reachability reclaims it once no draw references it.
export const OwnedSource: LC<
  { source: StorageSource; label?: string; counter?: string; render: Render }
> = ({ source, label, counter, render }) => {
  if (label) source.buffer.label = `molgpu:${label}`;
  useResource((dispose) => {
    trackOwnedBuffer(source.buffer, counter ?? "");
    dispose(() => releaseOwnedBuffer(source.buffer));
  }, [source.buffer]);
  return render(source);
};

/** Internal Live adapter: the array's identity identifies immutable packed
 * CPU contents, so a new array (never an in-place edit) triggers an upload. */
export const ColumnSource: LC<{
  data: Float32Array | Int32Array | Uint32Array;
  format: ColumnFormat;
  label?: string;
  counter?: string;
  render: (source: StorageSource | null) => LiveElement;
}> = ({ data, format, label, counter = label, render }) => {
  const column = useMemo(() => {
    const prepared = prepareColumn(data, format);
    if (prepared.count) {
      count("uploadBytes", counter ?? "", prepared.data.byteLength);
    }
    return prepared;
  }, [data, format]);
  if (!column.count) return render(null);
  return use(RawData, {
    data: column.data,
    format,
    length: column.count,
    render: (source: StorageSource) =>
      use(OwnedSource, { source, label, counter, render }),
  });
};
