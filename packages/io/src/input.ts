// Whole-file input for the non-streaming importers: bytes, a Blob/File, or a
// URL fetched once. Trajectories stream instead (see byte-source.ts).
import type { IoError, IoErrorCode } from "./error.ts";

/** Bytes, a `Blob`/`File`, or a URL to fetch. */
export type FileInput = Uint8Array | Blob | string | URL;

export async function readInput(
  input: FileInput,
  label: string,
  fail: (message: string, code: IoErrorCode, cause?: unknown) => IoError,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  if (input instanceof Uint8Array) return input;
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const bytes = new Uint8Array(await input.arrayBuffer());
    options.signal?.throwIfAborted();
    return bytes;
  }
  if (typeof input === "string" || input instanceof URL) {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(input, {
        signal: options.signal,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      throw fail(`Unable to fetch ${label} ${input}`, "FETCH_FAILED", error);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw fail(
        `Unable to fetch ${label} ${input} (${response.status} ${response.statusText})`,
        "FETCH_FAILED",
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    options.signal?.throwIfAborted();
    return bytes;
  }
  throw fail(
    `${label} input must be a Uint8Array, Blob, URL or URL string`,
    "INVALID_INPUT",
  );
}
