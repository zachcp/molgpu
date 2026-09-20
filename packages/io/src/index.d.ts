import type { StructureData } from '@molgpu/table';

/** Why a BinaryCIF import failed, stable enough to branch on. */
export type BcifErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_BCIF'
  | 'MISSING_ATOM_SITE'
  /** The optional Mol* parser is absent or failed to load. */
  | 'PARSER_UNAVAILABLE';

export class BcifParseError extends Error {
  constructor(message: string, code: BcifErrorCode, cause?: unknown);
  readonly name: 'BcifParseError';
  readonly code: BcifErrorCode;
}

/**
 * Lower a BinaryCIF mmCIF block to renderer-independent owned table columns.
 * Mol* is imported lazily inside this call, so consumers that never pass BCIF
 * bytes never load the parser. Rejects with {@link BcifParseError}.
 */
export function structureFromBcif(bytes: Uint8Array): Promise<StructureData>;
