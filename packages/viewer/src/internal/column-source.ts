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
} from "./instrumentation.ts";

type Render = (source: StorageSource) => LiveElement;

// The source and its buffer are owned by this subtree. RawData 0.20.0 does not destroy buffers.
export const OwnedSource: LC<
  { source: StorageSource; label?: string; counter?: string; render: Render }
> = ({ source, label, counter, render }) => {
  if (label) source.buffer.label = `molgpu:${label}`;
  useResource((dispose) => {
    trackOwnedBuffer(source.buffer, counter ?? "");
    dispose(() => {
      releaseOwnedBuffer(source.buffer);
      source.buffer.destroy();
    });
  }, [source.buffer]);
  return render(source);
};

/** Internal Live adapter: data+revision identifies immutable packed CPU contents. */
export const ColumnSource: LC<{
  data: Float32Array | Int32Array | Uint32Array;
  format: ColumnFormat;
  revision?: number;
  label?: string;
  counter?: string;
  render: (source: StorageSource | null) => LiveElement;
}> = ({ data, format, revision = 0, label, counter = label, render }) => {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("Expected nonnegative column revision");
  }
  const column = useMemo(() => {
    const prepared = prepareColumn(data, format);
    if (prepared.count) {
      count("uploadBytes", counter ?? "", prepared.data.byteLength);
    }
    return prepared;
  }, [data, format, revision]);
  if (!column.count) return render(null);
  return use(RawData, {
    data: column.data,
    format,
    length: column.count,
    render: (source: StorageSource) =>
      use(OwnedSource, { source, label, counter, render }),
  });
};
