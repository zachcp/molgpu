// Random-access byte reads for streaming trajectories: in-memory bytes, Blobs
// and HTTP Range requests behind one small interface.
import {
  createTrajectory,
  type TrajectoryData,
  type TrajectoryInput,
} from "@molgpu/table";
import type { ByteSource } from "./types.ts";
import { errorFor } from "./error.ts";

/** Failures from the trajectory readers. */
export const trajectoryError = errorFor("trajectory");

/** Default ceiling for downloading a whole file when a server ignores Range. */
export const MAX_FULL_DOWNLOAD: number = 256 * 1024 * 1024;

const clip = (
  size: number,
  offset: number,
  length: number,
): [number, number] => {
  if (
    !Number.isSafeInteger(offset) || offset < 0 ||
    !Number.isSafeInteger(length) || length < 0
  ) {
    throw new RangeError(`invalid byte range ${offset}+${length}`);
  }
  const start = Math.min(offset, size);
  return [start, Math.min(size, start + length)];
};

const aborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("read aborted", "AbortError");
  }
};

/** A `ByteSource` over bytes in memory (reads are zero-copy views) or a `Blob`. */
export function byteSource(input: Uint8Array | Blob | ByteSource): ByteSource {
  if (input instanceof Uint8Array) {
    const bytes = input;
    return Object.freeze({
      size: bytes.byteLength,
      read(offset: number, length: number, signal?: AbortSignal) {
        try {
          aborted(signal);
          const [start, end] = clip(bytes.byteLength, offset, length);
          return Promise.resolve(bytes.subarray(start, end));
        } catch (error) {
          return Promise.reject(error);
        }
      },
    });
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const blob = input;
    return Object.freeze({
      size: blob.size,
      async read(offset: number, length: number, signal?: AbortSignal) {
        aborted(signal);
        const [start, end] = clip(blob.size, offset, length);
        const bytes = new Uint8Array(
          await blob.slice(start, end).arrayBuffer(),
        );
        aborted(signal);
        return bytes;
      },
    });
  }
  if (
    input && typeof input === "object" &&
    Number.isSafeInteger((input as ByteSource).size) &&
    (input as ByteSource).size >= 0 &&
    typeof (input as ByteSource).read === "function"
  ) return input as ByteSource;
  throw trajectoryError(
    "expected a Uint8Array, a Blob or a ByteSource",
    "INVALID_INPUT",
  );
}

/**
 * A `ByteSource` over an HTTP resource read with `Range` requests. A server
 * that answers the probe with 200 instead of 206 ignores Range: the whole body
 * is then downloaded once, and refused with `TRAJECTORY_TOO_LARGE` when it is
 * over `maxDownload` (default 256 MiB). Strong ETags (else Last-Modified)
 * are pinned across reads. Without either validator, callers must use an
 * immutable URL; total-size checks cannot detect same-size content changes.
 */
export async function urlByteSource(
  url: string | URL,
  options: {
    maxDownload?: number;
    signal?: AbortSignal;
    fetch?: typeof fetch;
  } = {},
): Promise<ByteSource> {
  const { maxDownload = MAX_FULL_DOWNLOAD, signal } = options;
  const get = options.fetch ?? fetch;
  const request = async (headers: HeadersInit, sig?: AbortSignal) => {
    aborted(sig);
    let response: Response;
    try {
      response = await get(url, { headers, signal: sig });
    } catch (error) {
      aborted(sig);
      if ((error as Error)?.name === "AbortError") throw error;
      throw trajectoryError(
        `Unable to fetch ${url}`,
        "FETCH_FAILED",
        error,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw trajectoryError(
        `Unable to fetch ${url} (${response.status})`,
        "FETCH_FAILED",
      );
    }
    return response;
  };
  // Vite's dev server treats bytes=0-0 as open-ended. Request two bytes and
  // accept the clipped one-byte response for a one-byte file.
  const probe = await request({ Range: "bytes=0-1" }, signal);
  if (probe.status === 206) {
    const parseRange = (
      response: Response,
      start: number,
      end: number,
      total?: number,
    ): number => {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
        response.headers.get("content-range") ?? "",
      );
      const values = match?.slice(1).map(Number);
      if (
        response.status !== 206 || !values ||
        !values.every(Number.isSafeInteger) ||
        values[0] !== start ||
        values[1] !== Math.min(end, values[2]) - 1 ||
        values[2] <= start ||
        (total !== undefined && values[2] !== total)
      ) {
        throw trajectoryError(
          `${url}: invalid Content-Range for bytes ${start}-${end - 1}${
            total === undefined ? "" : `/${total}`
          }`,
          "FETCH_FAILED",
        );
      }
      return values[2];
    };
    let size: number;
    try {
      size = parseRange(probe, 0, 2);
      const first = new Uint8Array(await probe.arrayBuffer());
      aborted(signal);
      if (first.byteLength !== Math.min(2, size)) {
        throw trajectoryError(
          `${url}: Range probe must contain ${Math.min(2, size)} bytes`,
          "FETCH_FAILED",
        );
      }
    } catch (error) {
      await probe.body?.cancel().catch(() => {});
      throw error;
    }
    const etag = probe.headers.get("etag");
    const strong = etag && !etag.startsWith("W/") ? etag : null;
    const modified = probe.headers.get("last-modified");
    return Object.freeze({
      size,
      async read(offset: number, length: number, sig?: AbortSignal) {
        aborted(sig);
        const [start, end] = clip(size, offset, length);
        if (end === start) return new Uint8Array();
        const headers: Record<string, string> = {
          Range: `bytes=${start}-${end - 1}`,
        };
        if (strong) headers["If-Match"] = strong;
        else if (modified) headers["If-Unmodified-Since"] = modified;
        const response = await request(headers, sig);
        try {
          parseRange(response, start, end, size);
          if (
            (strong && response.headers.get("etag") !== strong) ||
            (!strong && modified &&
              response.headers.get("last-modified") !== modified)
          ) {
            throw trajectoryError(
              `${url}: remote resource changed during Range reads`,
              "FETCH_FAILED",
            );
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          aborted(sig);
          if (bytes.byteLength !== end - start) {
            throw trajectoryError(
              `${url}: expected ${
                end - start
              } bytes from ${start}, got ${bytes.byteLength}`,
              "FETCH_FAILED",
            );
          }
          return bytes;
        } catch (error) {
          await response.body?.cancel().catch(() => {});
          throw error;
        }
      },
    });
  }
  if (probe.status !== 200) {
    await probe.body?.cancel();
    throw trajectoryError(
      `${url}: expected HTTP 200 or 206, got ${probe.status}`,
      "FETCH_FAILED",
    );
  }
  const declared = Number(probe.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxDownload) {
    await probe.body?.cancel();
    throw trajectoryError(
      `${url} is ${declared} bytes and the server ignores Range requests; ` +
        `pass a larger maxDownload (now ${maxDownload}) to download it whole`,
      "TRAJECTORY_TOO_LARGE",
    );
  }
  // Content-Length may be absent (chunked transfer) or incorrect. Enforce
  // the cap while consuming the body, before buffering the entire response.
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = probe.body?.getReader();
  if (reader) {
    try {
      while (true) {
        aborted(signal);
        const { done, value } = await reader.read();
        aborted(signal);
        if (done) break;
        length += value.byteLength;
        if (length > maxDownload) {
          await reader.cancel();
          throw trajectoryError(
            `${url} exceeds maxDownload ${maxDownload}`,
            "TRAJECTORY_TOO_LARGE",
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  aborted(signal);
  return byteSource(bytes);
}

/**
 * Sequential header reads over a `ByteSource` in large blocks, so walking
 * thousands of small frame headers costs a few reads, not one per header.
 */
export class BlockReader {
  #source: ByteSource;
  #block: Uint8Array = new Uint8Array();
  #start = 0;
  #blockSize: number;
  #signal?: AbortSignal;
  reads = 0;
  constructor(
    source: ByteSource,
    blockSize = 4 * 1024 * 1024,
    signal?: AbortSignal,
  ) {
    this.#source = source;
    this.#blockSize = blockSize;
    this.#signal = signal;
  }
  get size(): number {
    return this.#source.size;
  }
  /** A view of `length` bytes from `offset`, or fewer at the end of the file. */
  async bytes(offset: number, length: number): Promise<Uint8Array> {
    aborted(this.#signal);
    const end = Math.min(offset + length, this.#source.size);
    if (offset < this.#start || end > this.#start + this.#block.byteLength) {
      this.#block = await this.#source.read(
        offset,
        Math.max(this.#blockSize, length),
        this.#signal,
      );
      aborted(this.#signal);
      this.#start = offset;
      this.reads++;
    }
    return this.#block.subarray(offset - this.#start, end - this.#start);
  }
  /** A DataView of exactly `length` bytes, or a TRUNCATED_TRAJECTORY error. */
  async view(offset: number, length: number, what: string): Promise<DataView> {
    const bytes = await this.bytes(offset, length);
    if (bytes.byteLength < length) {
      throw trajectoryError(
        `${what}: the file ends at byte ${this.size}, inside ${length} bytes from ${offset}`,
        "TRUNCATED_TRAJECTORY",
      );
    }
    return new DataView(bytes.buffer, bytes.byteOffset, length);
  }
}

/** `createTrajectory` whose validation failures surface as INVALID_TRAJECTORY. */
export function parsedTrajectory(
  format: string,
  input: TrajectoryInput,
): TrajectoryData {
  try {
    return createTrajectory(input);
  } catch (error) {
    throw trajectoryError(
      `${format}: ${(error as Error).message}`,
      "INVALID_TRAJECTORY",
      error,
    );
  }
}

/** Read exactly one frame's bytes, or reject with TRUNCATED_TRAJECTORY. */
export async function readExactly(
  source: ByteSource,
  offset: number,
  length: number,
  signal: AbortSignal | undefined,
  what: string,
): Promise<Uint8Array> {
  aborted(signal);
  const bytes = await source.read(offset, length, signal);
  aborted(signal);
  if (bytes.byteLength !== length) {
    throw trajectoryError(
      `${what}: expected ${length} bytes from ${offset}, got ${bytes.byteLength}`,
      "TRUNCATED_TRAJECTORY",
    );
  }
  return bytes;
}
