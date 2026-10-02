/** Which importer failed. */
export type IoFormat =
  | "bcif"
  | "ccp4"
  | "pqr"
  | "trajectory"
  | "surface"
  | "selection";

/** Why an import failed, stable enough to branch on. */
export type IoErrorCode =
  /** The input had the wrong type, or an option was invalid. */
  | "INVALID_INPUT"
  /** `count` is 0 (`surface`). */
  | "EMPTY_INPUT"
  /** The Mol* parser rejected the bytes (`bcif`). */
  | "INVALID_BCIF"
  /** The first data block has no `atom_site` category (`bcif`). */
  | "MISSING_ATOM_SITE"
  /** The header or data is malformed or truncated, or Mol* rejected it (`ccp4`). */
  | "INVALID_MAP"
  /** The map's value mode is not one the reader supports (`ccp4`). */
  | "UNSUPPORTED_MODE"
  /** The map or predicted surface grid exceeds `maxSamples` (`ccp4`, `surface`). */
  | "VOLUME_TOO_LARGE"
  /** A record is malformed, or the records do not form a valid structure (`pqr`). */
  | "INVALID_PQR"
  /** The file has no ATOM or HETATM records (`pqr`). */
  | "NO_ATOMS"
  /** The PQR has no chain IDs and a residue key spans several chains (`pqr`). */
  | "AMBIGUOUS_CHAIN"
  /** A header or frame is malformed, or frames disagree on the atom count (`trajectory`). */
  | "INVALID_TRAJECTORY"
  /** A valid file uses a feature the reader does not support (`trajectory`). */
  | "UNSUPPORTED_TRAJECTORY"
  /** The file ends inside its header or holds no complete frame (`trajectory`). */
  | "TRUNCATED_TRAJECTORY"
  /** The server ignores Range requests and the file is over `maxDownload` (`trajectory`). */
  | "TRAJECTORY_TOO_LARGE"
  /** A network request failed or returned an error status (`trajectory`). */
  | "FETCH_FAILED"
  /** The text is empty or does not parse (`selection`). */
  | "INVALID_SELECTION"
  /** The text uses a symbol outside `options.symbols` (`selection`). */
  | "UNSUPPORTED_SYMBOL"
  /** The optional Mol* parser or decoder is absent or failed to load. */
  | "PARSER_UNAVAILABLE"
  /** The optional Mol* surface code is absent, failed to load, or threw (`surface`). */
  | "FIELD_UNAVAILABLE"
  /** The requested biological assembly id is not in the file (`bcif`). */
  | "UNKNOWN_ASSEMBLY";

/** Every failure @molgpu/io raises: which importer, a stable code, and the cause. */
export class IoError extends Error {
  override readonly name: "IoError";
  readonly format: IoFormat;
  readonly code: IoErrorCode;
  constructor(
    message: string,
    format: IoFormat,
    code: IoErrorCode,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "IoError";
    this.format = format;
    this.code = code;
  }
}

/** An IoError constructor bound to one importer's format. */
export const errorFor = (format: IoFormat) =>
(
  message: string,
  code: IoErrorCode,
  cause?: unknown,
): IoError => new IoError(message, format, code, cause);
