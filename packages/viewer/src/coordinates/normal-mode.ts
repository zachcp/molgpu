import {
  type LC,
  type LiveElement,
  use,
  useContext,
  useMemo,
} from "@use-gpu/live";
import { wgsl } from "@use-gpu/shader/wgsl";
import type { NormalModeData } from "@molgpu/dynamics";
import { normalModeWgsl, validateNormalMode } from "@molgpu/dynamics/wgsl";
import { useCoordinates } from "./coordinates-context.ts";
import { CoordinateKernel } from "./coordinate-kernel.ts";
import { useComputeBuffers } from "../internal/compute-buffers.ts";

import { TimelineContext } from "../timeline-context.ts";
import type { NormalModeProps, ViewerComponent } from "../types.ts";

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
  useMemo(() => {
    if (upstream) validateNormalMode(mode, upstream.count);
    return true;
  }, [mode, mode.version, upstream?.count]);
  const sources = useComputeBuffers((buffers) => {
    if (!upstream || !active) return null;
    const usage = STORAGE | COPY_DST;
    return [
      buffers.source(
        mode.atomToNode,
        usage,
        "coords:normal-mode:map",
        mode.version,
      ),
      buffers.source(
        mode.vectors,
        usage,
        "coords:normal-mode:vectors",
        mode.version,
      ),
    ];
  }, [upstream?.count, mode, mode.version, active]);
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
