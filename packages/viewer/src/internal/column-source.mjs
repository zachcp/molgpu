import { use, useMemo, useResource } from '@use-gpu/live';
import { RawData } from '@use-gpu/workbench';
import { prepareColumn } from './columns.mjs';

// The source and its buffer are owned by this subtree. Consumers must not retain
// either beyond render/resource lifetime. RawData 0.20.0 does not destroy buffers.
const OwnedSource = ({ source, label, render }) => {
  if (label) source.buffer.label = `molgpu:${label}`;
  useResource(dispose => { dispose(() => source.buffer.destroy()); }, [source.buffer]);
  return render(source);
};

/** Internal Live adapter. data+revision identifies immutable packed CPU contents.
 * RawData handles GPU padding and reconciliation. Explicit length means ROWS,
 * not scalar array length. Empty input removes the entire GPU subtree. */
export const ColumnSource = ({ data, format, revision = 0, label, render }) => {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError('Expected nonnegative column revision');
  const column = useMemo(() => prepareColumn(data, format), [data, format, revision]);
  if (!column.count) return render(null);
  return use(RawData, { data: column.data, format, length: column.count,
    render: source => use(OwnedSource, { source, label, render }) });
};
