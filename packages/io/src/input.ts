// Whole-file input for the non-streaming importers: bytes, a Blob/File, or a
// URL fetched once. Trajectories stream instead (see byte-source.ts).
import type { IoError, IoErrorCode } from "./error.ts";

/** Bytes, a `Blob`/`File`, or a URL to fetch. */
export type FileInput = Uint8Array | Blob | string | URL;

export async function readInput(
  input: FileInput,
  label: string,
  fail: (message: string, code: IoErrorCode, cause?: unknown) => IoError,
): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  if (typeof input === "string" || input instanceof URL) {
    let response: Response;
    try {
      response = await fetch(input);
    } catch (error) {
      throw fail(`Unable to fetch ${label} ${input}`, "FETCH_FAILED", error);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw fail(
        `Unable to fetch ${label} ${input} (${response.status} ${response.statusText})`,
        "FETCH_FAILED",
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw fail(
    `${label} input must be a Uint8Array, Blob, URL or URL string`,
    "INVALID_INPUT",
  );
}
