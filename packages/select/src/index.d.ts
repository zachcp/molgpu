import type { StructureData } from '@molgpu/table';

export type Domain = 'atom' | 'residue' | 'bond';
export type RevisionStream = 'topology' | 'positions' | 'attributes';

/**
 * A pure, dataset-independent recipe. Build once, resolve against many datasets.
 *
 * Opaque: create queries only with `all`, `where`, `element`, `comp` and
 * `within`, and pass them only to this package's functions. The four fields
 * below are the public surface. Runtime query objects carry further
 * per-kind fields (for example a `where` predicate or a `within` cutoff) that
 * are internal and may change in any release.
 */
export interface SelectionQuery {
  readonly type: string;
  readonly domain: Domain;
  readonly label: string;
  readonly deps: readonly RevisionStream[];
}

/** Mapping from a converted selection's rows back to the source domain rows. */
export type SourceMap =
  | { readonly domain: 'residue'; readonly rows: Uint32Array }
  | { readonly domain: 'atom'; readonly a: Uint32Array; readonly b: Uint32Array };

/** A query resolved against one dataset: identity-, domain-, and revision-bound. */
export interface Selection {
  readonly domain: Domain;
  /** The originating StructureData identity; compared by reference for set ops. */
  readonly dataset: StructureData['identity'];
  readonly indices: Uint32Array;
  /** Revision of each stream the resolution read, for staleness and set-op checks. */
  readonly deps: Readonly<Partial<Record<RevisionStream, number>>>;
  /** Human label from the query; NOT the cache key. */
  readonly label: string;
  /** Library-owned identity derived from dataset, revisions, and membership. */
  readonly id: string;
  readonly source: SourceMap | null;
}

export function all(domain?: Domain): SelectionQuery;
export function where(domain: Domain, label: string, test: (data: StructureData, row: number) => boolean, deps?: readonly RevisionStream[]): SelectionQuery;
export function element(z: number): SelectionQuery;
export function comp(names: readonly string[]): SelectionQuery;
export function within(cutoff: number, of: SelectionQuery): SelectionQuery;

export function resolve(query: SelectionQuery, data: StructureData): Selection;

export function union(a: Selection, b: Selection): Selection;
export function intersect(a: Selection, b: Selection): Selection;
export function difference(a: Selection, b: Selection): Selection;

export function toAtoms(sel: Selection, data: StructureData): Selection;
export function toResidues(sel: Selection, data: StructureData): Selection;
export function toBonds(sel: Selection, data: StructureData, options?: { readonly endpoints?: 'both' | 'either' }): Selection;

export function isStale(sel: Selection, data: StructureData): boolean;
export function isEmpty(sel: Selection): boolean;
export function count(sel: Selection): number;
