import { use } from '@use-gpu/live';
import { compile } from '@molgpu/fields';
import { ColumnSource } from './column-source.mjs';

/** A @molgpu/fields Field (vs a flat VectorLike colour). */
export const isField = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.kind === 'string' && !!v.type;

/** The atom attribute columns a colour field reads, to gather alongside geometry. */
export const fieldAttrNames = (field) => !field ? [] :
  compile(field, { target: 'link', domain: 'atom' }).bindings
    .filter((b) => b.kind === 'buffer' && b.id.startsWith('attr:')).map((b) => b.id.slice(5));

/** Fold a list of columns into nested owned sources, then render with the map. */
export const withColumns = (specs, render) => {
  const step = (i, acc) => i === specs.length ? render(acc)
    : use(ColumnSource, { data: specs[i].data, format: specs[i].format, label: specs[i].key,
        render: (source) => step(i + 1, { ...acc, [specs[i].key]: source }) });
  return step(0, {});
};
