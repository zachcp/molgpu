// One entry point over the trajectory readers: bytes, Blobs/Files, ByteSources
// and URLs, with the format taken from an option or the file name.
import type { TrajectoryData } from "@molgpu/table";
import { byteSource, trajectoryError, urlByteSource } from "./byte-source.ts";
import { trajectoryFromDcd } from "./dcd.ts";
import { trajectoryFromTrr } from "./trr.ts";
import { trajectoryFromXtc } from "./xtc.ts";
import type {
  ByteSource,
  OpenTrajectoryOptions,
  TrajectoryFormat,
} from "./types.ts";

const readers = {
  dcd: trajectoryFromDcd,
  xtc: trajectoryFromXtc,
  trr: trajectoryFromTrr,
} as const;

/** The trajectory format a file name or URL implies, or null. */
export function trajectoryFormat(name: string): TrajectoryFormat | null {
  const path = name.split(/[?#]/)[0].toLowerCase();
  const extension = /\.([a-z0-9]+)$/.exec(path)?.[1];
  return extension && extension in readers
    ? extension as TrajectoryFormat
    : null;
}

/**
 * Open a trajectory for streaming from bytes, a `Blob`/`File`, a `ByteSource`
 * or a URL (read with HTTP Range requests). The format is
 * `options.format`, else the file name's extension (`.dcd`, `.xtc`, `.trr`).
 */
export async function openTrajectory(
  input: Uint8Array | Blob | ByteSource | string | URL,
  options: OpenTrajectoryOptions = {},
): Promise<TrajectoryData> {
  const name = typeof input === "string" || input instanceof URL
    ? String(input)
    : typeof File !== "undefined" && input instanceof File
    ? input.name
    : "";
  const format = options.format ?? trajectoryFormat(name);
  if (!format || !(format in readers)) {
    throw trajectoryError(
      options.format
        ? `unknown trajectory format ${options.format}`
        : `cannot tell the trajectory format of ${
          name || "the input"
        }; pass format`,
      "INVALID_INPUT",
    );
  }
  const source = typeof input === "string" || input instanceof URL
    ? await urlByteSource(input, options)
    : byteSource(input);
  return readers[format](source, options);
}
