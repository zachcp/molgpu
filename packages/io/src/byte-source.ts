// Random-access byte reads for streaming trajectories: in-memory bytes, Blobs
// and HTTP Range requests behind one small interface.
import {
  createTrajectory,
  type TrajectoryData,
  type TrajectoryInput,
} from "@molgpu/table";
import type { ByteSource, TrajectoryErrorCode } from "./types.ts";

/** A machine-readable failure reading a trajectory. */
export class TrajectoryParseError extends Error {
  override readonly name: "TrajectoryParseError";
  readonly code: TrajectoryErrorCode;
  constructor(message: string, code: TrajectoryErrorCode, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TrajectoryParseError";
    this.code = code;
  }
}

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
    typeof (input as ByteSource).read === "function"
  ) return input as ByteSource;
  throw new TrajectoryParseError(
    "expected a Uint8Array, a Blob or a ByteSource",
    "INVALID_INPUT",
  );
}

/**
 * A `ByteSource` over an HTTP resource read with `Range` requests. A server
 * that answers the probe with 200 instead of 206 ignores Range: the whole body
 * is then downloaded once, and refused with `TRAJECTORY_TOO_LARGE` when it is
 * over `maxDownload` (default 256 MiB).
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
    let response: Response;
    try {
      response = await get(url, { headers, signal: sig });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      throw new TrajectoryParseError(
        `Unable to fetch ${url}`,
        "FETCH_FAILED",
        error,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TrajectoryParseError(
        `Unable to fetch ${url} (${response.status})`,
        "FETCH_FAILED",
      );
    }
    return response;
  };
  const probe = await request({ Range: "bytes=0-0" }, signal);
  if (probe.status === 206) {
    const range = probe.headers.get("content-range") ?? "";
    await probe.body?.cancel();
    const size = Number(/\/(\d+)\s*$/.exec(range)?.[1]);
    if (!Number.isSafeInteger(size)) {
      throw new TrajectoryParseError(
        `${url}: a 206 response without a total size in Content-Range`,
        "FETCH_FAILED",
      );
    }
    return Object.freeze({
      size,
      async read(offset: number, length: number, sig?: AbortSignal) {
        const [start, end] = clip(size, offset, length);
        if (end === start) return new Uint8Array();
        const response = await request(
          { Range: `bytes=${start}-${end - 1}` },
          sig,
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (response.status !== 206 || bytes.byteLength !== end - start) {
          throw new TrajectoryParseError(
            `${url}: expected ${
              end - start
            } bytes from ${start}, got ${bytes.byteLength}`,
            "FETCH_FAILED",
          );
        }
        return bytes;
      },
    });
  }
  const declared = Number(probe.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxDownload) {
    await probe.body?.cancel();
    throw new TrajectoryParseError(
      `${url} is ${declared} bytes and the server ignores Range requests; ` +
        `pass a larger maxDownload (now ${maxDownload}) to download it whole`,
      "TRAJECTORY_TOO_LARGE",
    );
  }
  const bytes = new Uint8Array(await probe.arrayBuffer());
  if (bytes.byteLength > maxDownload) {
    throw new TrajectoryParseError(
      `${url} is ${bytes.byteLength} bytes, over maxDownload ${maxDownload}`,
      "TRAJECTORY_TOO_LARGE",
    );
  }
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
    const end = Math.min(offset + length, this.#source.size);
    if (offset < this.#start || end > this.#start + this.#block.byteLength) {
      this.#block = await this.#source.read(
        offset,
        Math.max(this.#blockSize, length),
        this.#signal,
      );
      this.#start = offset;
      this.reads++;
    }
    return this.#block.subarray(offset - this.#start, end - this.#start);
  }
  /** A DataView of exactly `length` bytes, or a TRUNCATED_TRAJECTORY error. */
  async view(offset: number, length: number, what: string): Promise<DataView> {
    const bytes = await this.bytes(offset, length);
    if (bytes.byteLength < length) {
      throw new TrajectoryParseError(
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
    throw new TrajectoryParseError(
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
  const bytes = await source.read(offset, length, signal);
  if (bytes.byteLength !== length) {
    throw new TrajectoryParseError(
      `${what}: expected ${length} bytes from ${offset}, got ${bytes.byteLength}`,
      "TRUNCATED_TRAJECTORY",
    );
  }
  return bytes;
}
