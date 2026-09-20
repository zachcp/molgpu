import { use, useAwait } from '@use-gpu/live';
import { StructureProvider } from './structure-context.mjs';

const defaultLoader = async (src, cancelled) => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Unable to load structure (${response.status} ${response.statusText})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (cancelled()) return null;
  const { structureFromBcif } = await import('@molgpu/io');
  const data = await structureFromBcif(bytes);
  return cancelled() ? null : data;
};

/**
 * Own a preloaded StructureData or load one BCIF source. It intentionally
 * creates no renderer, so it nests under the caller's existing use.gpu scene.
 */
export const Structure = ({ data, src, loader = defaultLoader, loading = null, error = null, children, maxSelections }) => {
  if (data !== undefined && src !== undefined) throw new TypeError('<Structure> accepts either data or src, not both');
  if (data === undefined && src === undefined) throw new TypeError('<Structure> requires data or src');
  if (src !== undefined && typeof src !== 'string') throw new TypeError('<Structure> src must be a string');
  if (typeof loader !== 'function') throw new TypeError('<Structure> loader must be a function');
  const [loaded, failure, pending] = useAwait(data === undefined
    ? cancelled => Promise.resolve(loader(src, cancelled))
    : null, [src, loader]);
  if (data !== undefined) return use(StructureProvider, { data, maxSelections, children });
  if (pending || loaded === undefined) return typeof loading === 'function' ? loading() : loading;
  if (failure) return typeof error === 'function' ? error(failure) : error;
  // A cancelled request resolves to null and must not mount stale content.
  return loaded ? use(StructureProvider, { data: loaded, maxSelections, children }) : null;
};
