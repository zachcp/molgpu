import { type LC, type LiveElement, use, useMemo, useRef } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import type { Coordinates } from "../coordinates-context.ts";
import { Published } from "./coordinate-kernel.ts";
import { count } from "./instrumentation.ts";

const STORAGE = 0x0080;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;

/**
 * Encode a provider's stages, reading `input` and writing packed `output`. It
 * may return a callback to run after the submission, e.g. to map a small
 * status buffer the stages copied out.
 */
export type EncodePasses = (
  encoder: GPUCommandEncoder,
  input: GPUBuffer,
  output: GPUBuffer,
  generation: number,
) => void | (() => void);

/**
 * A coordinate provider built from raw compute stages (reductions, graph
 * traversals). Ordered use.gpu `Kernel` stages can express `<Superpose>`, but
 * measured no faster and cost a split provider mechanism, f32 parameters and a
 * status copy outside the pass; `<Unwrap>` has a data-dependent dispatch count
 * and clears buffers between stages. Both stay raw for those reasons
 * (docs/findings/2026-10-04-superpose-ordered-kernels.md). It owns one packed
 * output. Once per content generation, during render, it encodes every stage
 * into one command buffer and submits it. The submit lands after the upstream
 * provider's dispatch and before any descendant's, so all stages read the same
 * upstream generation, in order, with no CPU readback. It waits for an
 * upstream kernel's first dispatch (`ready`) and forwards readiness.
 */
export const CoordinatePasses: LC<{
  upstream: Coordinates;
  label: string;
  /** Output-affecting parameters and structural input versions. */
  parameterKey: string;
  encode: EncodePasses;
  children: LiveElement;
}> = ({ upstream, label, parameterKey, encode, children }) => {
  const device = useDeviceContext();
  const output = useMemo(
    () =>
      device.createBuffer({
        size: Math.max(16, upstream.count * 12),
        usage: STORAGE | COPY_SRC | COPY_DST,
        label: "molgpu:coords:provider",
      }),
    [device, upstream.count],
  );
  // An upstream kernel that has not dispatched yet holds zeros. Wait for its
  // ready generation instead of encoding from it: keep the previous output
  // (still ready) or, for a new output buffer, publish generation 0, not ready.
  const next = useRef(0);
  const filled = useRef<GPUBuffer | null>(null);
  const generation = useMemo(() => {
    if (upstream.ready === false) {
      return filled.current === output ? next.current : 0;
    }
    filled.current = output;
    return ++next.current;
  }, [
    upstream.source.buffer,
    upstream.generation,
    upstream.ready,
    parameterKey,
    output,
  ]);
  useMemo(() => {
    if (!generation) return;
    const encoder = device.createCommandEncoder({ label: `molgpu:${label}` });
    const after = encode(encoder, upstream.source.buffer, output, generation);
    device.queue.submit([encoder.finish()]);
    count("gathers", `${label}:dispatch`);
    after?.();
  }, [generation]);
  return use(Published, {
    upstream,
    source: { buffer: output },
    generation,
    ready: generation > 0,
    children,
  });
};
