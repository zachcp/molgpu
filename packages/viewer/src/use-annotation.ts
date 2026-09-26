import { useAwait, useMemo } from '@use-gpu/live';
import { joinAnnotation, type Field, type JoinOptions } from '@molgpu/fields';
import { useStructure } from './structure-context.ts';

const fetchRecords = async (src: string, cancelled: () => boolean): Promise<unknown> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Unable to load annotation (${response.status} ${response.statusText})`);
  const records = await response.json();
  return cancelled() ? null : records;
};

/**
 * Join external annotation `records` (or a JSON `src` fetched with loading/error
 * and stale-result protection) onto the nearest <Structure> by identity, and
 * return the resulting field. The remaining input fields are @molgpu/fields
 * JoinOptions. The join reruns only when the structure, the records or one of
 * those options changes, so keep `fields` and `value` stable across renders
 * (a module constant or a memoised value). Returns `{ field, pending, error }`;
 * `field` is null while loading or before any records are available, and is
 * otherwise an ordinary field usable anywhere (e.g. `color={colormap(...field)}`).
 */
export function useAnnotation<R = unknown>(input: {
  records?: readonly R[];
  src?: string;
  loader?: (src: string, cancelled: () => boolean) => unknown;
  domain?: 'residue' | 'chain';
  fields: readonly string[];
  value?: (record: R) => number | readonly number[];
  type?: unknown;
  policy?: 'fallback' | 'fail';
  fallback?: number | readonly number[];
  duplicate?: 'error' | 'first' | 'last';
  lift?: boolean;
}): { field: Field | null; pending: boolean; error: unknown } {
  const { records, src, loader = fetchRecords, domain, fields, value, type, policy, fallback, duplicate, lift } = input;
  const { resource } = useStructure();
  const { data } = resource;
  const [fetched, failure, pending] = useAwait(src != null ? async (cancelled: () => boolean) => loader(src, cancelled) : null, [src, loader]);
  const source = (src != null ? fetched : records) as readonly R[] | null | undefined;
  // Depend on each option, not on an options object rebuilt every render, so
  // the join (and the field identity downstream) is stable between renders.
  const field = useMemo(() => {
    if (!source) return null;
    // Unset options arrive as undefined, which joinAnnotation's defaults cover.
    const options = { domain, fields, value, type, policy, fallback, duplicate, lift } as unknown as JoinOptions<R>;
    return joinAnnotation(data, source, options);
  }, [data, source, domain, fields, value, type, policy, fallback, duplicate, lift]);
  return { field, pending: src != null ? pending : false, error: failure ?? null };
}
