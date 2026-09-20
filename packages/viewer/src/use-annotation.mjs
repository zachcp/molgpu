import { useAwait, useMemo } from '@use-gpu/live';
import { joinAnnotation } from '@molgpu/fields';
import { useStructure } from './structure-context.mjs';

const fetchRecords = async (src, cancelled) => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Unable to load annotation (${response.status} ${response.statusText})`);
  const records = await response.json();
  return cancelled() ? null : records;
};

/**
 * Join external annotation `records` (or a JSON `src` fetched with loading/error
 * and stale-result protection) onto the nearest <Structure> by identity, and
 * return the resulting field. `options` is a @molgpu/fields JoinOptions and must
 * be stable across renders (memoise it). Returns `{ field, pending, error }`;
 * `field` is null while loading or before any records are available, and is
 * otherwise an ordinary field usable anywhere (e.g. `color={colormap(...field)}`).
 */
export const useAnnotation = ({ records, src, loader = fetchRecords, ...options }) => {
  const { resource } = useStructure();
  const { data } = resource;
  const [fetched, failure, pending] = useAwait(src != null ? (cancelled) => loader(src, cancelled) : null, [src, loader]);
  const source = src != null ? fetched : records;
  const field = useMemo(() => (source ? joinAnnotation(data, source, options) : null), [data, source, options]);
  return { field, pending: src != null ? pending : false, error: failure ?? null };
};
