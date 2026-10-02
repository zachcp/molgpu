import {
  type LC,
  type LiveElement,
  use,
  useContext,
  useMemo,
  useResource,
} from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import { useDeviceContext } from "@use-gpu/workbench";
import type { NormalModeData } from "@molgpu/dynamics";
import { normalModeWgsl, validateNormalMode } from "@molgpu/dynamics/wgsl";
import { useCoordinates } from "./coordinates-context.ts";
import { CoordinateKernel } from "./internal/coordinate-kernel.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";

import { TimelineContext } from "./timeline-context.ts";
import type { NormalModeProps, ViewerComponent } from "./types.ts";

const SHADER = wgsl`${normalModeWgsl}`;
const STORAGE = 0x0080;
const COPY_DST = 0x0008;

const Mode: LC<{
  mode: NormalModeData;
  scale: number;
  /** False only for zero amplitude. A scale that crosses zero while animating
   * keeps the kernel and its buffers mounted. */
  active: boolean;
  children: LiveElement;
}> = ({ mode, scale, active, children }) => {
  const upstream = useCoordinates();
  const device = useDeviceContext();
  useMemo(() => {
    if (upstream) validateNormalMode(mode, upstream.count);
    return true;
  }, [mode, mode.version, upstream?.count]);
  const sources = useMemo<readonly StorageSource[] | null>(() => {
    if (!upstream || !active) return null;
    const make = (
      data: Float32Array | Uint32Array,
      format: "f32" | "u32",
      label: string,
    ): StorageSource => {
      const buffer = device.createBuffer({
        size: Math.max(4, data.byteLength),
        usage: STORAGE | COPY_DST,
        label,
      });
      if (data.byteLength) device.queue.writeBuffer(buffer, 0, data);
      trackOwnedBuffer(buffer, label);
      count("uploadBytes", label, data.byteLength);
      return Object.freeze({
        buffer,
        format,
        length: data.length,
        size: [data.length],
        version: mode.version,
      }) as StorageSource;
    };
    return [
      make(mode.atomToNode, "u32", "coords:normal-mode:map"),
      make(mode.vectors, "f32", "coords:normal-mode:vectors"),
    ];
  }, [device, upstream?.count, mode, mode.version, active]);
  useResource((dispose) => {
    if (sources) {
      dispose(() => {
        for (const source of sources) {
          releaseOwnedBuffer(source.buffer);
          source.buffer.destroy();
        }
      });
    }
  }, [sources]);
  if (!upstream || !sources) return children;
  return use(CoordinateKernel, {
    upstream,
    shader: SHADER,
    args: [scale],
    sources,
    parameterKey: `${mode.version}:${scale}`,
    children,
  });
};

/** Add a precomputed guide-node mode to all mapped atoms. */
export const NormalMode: ViewerComponent<NormalModeProps> = (
  { mode, amplitude, frequency = 0, phase = 0, children },
) => {
  if (![amplitude, frequency, phase].every(Number.isFinite)) {
    throw new TypeError(
      "normal mode amplitude, frequency and phase must be finite",
    );
  }
  const time = useContext(TimelineContext);
  if (frequency !== 0 && time === null) {
    throw new Error(
      "<NormalMode> frequency needs a <TimelineProvider> ancestor",
    );
  }
  const scale = amplitude *
    Math.sin(2 * Math.PI * frequency * (time ?? 0) + phase);
  if (!Number.isFinite(scale)) {
    throw new RangeError("normal mode scale overflows");
  }
  return (use(Mode, {
    mode,
    scale,
    active: amplitude !== 0,
    children: children,
  }));
};
