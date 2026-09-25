import { use, useMemo, useResource } from '@use-gpu/live';
import { RawData } from '@use-gpu/workbench';
import { prepareColumn } from './columns.mjs';
import { count, trackOwnedBuffer, releaseOwnedBuffer } from './instrumentation.mjs';

// The source and its buffer are owned by this subtree. Consumers must not retain
// either beyond render/resource lifetime. RawData 0.20.0 does not destroy buffers.
export const OwnedSource = ({ source, label, counter, render }) => {
  if (label) source.buffer.label = `molgpu:${label}`;
  useResource(dispose => {
    trackOwnedBuffer(source.buffer, counter);
    dispose(() => { releaseOwnedBuffer(source.buffer); source.buffer.destroy(); });
  }, [source.buffer]);
  return render(source);
};

/** Internal Live adapter. data+revision identifies immutable packed CPU contents.
 * RawData handles GPU padding and reconciliation. Explicit length means ROWS,
 * not scalar array length. Empty input removes the entire GPU subtree.
 * `counter` names this column in the dev-only instrumentation (defaults to
 * `label`); it has no effect on rendering. */
export const ColumnSource = ({ data, format, revision = 0, label, counter = label, render }) => {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Expected nonnegative column revision');
  const column = useMemo(() => {
    const prepared = prepareColumn(data, format);
    // RawData uploads exactly when this prepared copy changes.
    if (prepared.count) count('uploadBytes', counter, prepared.data.byteLength);
    return prepared;
  }, [data, format, revision]);
  if (!column.count) return render(null);
  return use(RawData, { data: column.data, format, length: column.count,
    render: source => use(OwnedSource, { source, label, counter, render }) });
};
