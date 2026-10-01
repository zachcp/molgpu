// Double-buffered, allocation-guarded readback of one small fixed-size status
// buffer, shared by <Superpose> and <Unwrap>. Two staging buffers alternate
// so a new copy never waits on the previous map. Retired owners discard late
// results and let each busy slot finish mapping before destruction.
import { useMemo, useRef, useResource } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import { releaseOwnedBuffer, trackOwnedBuffer } from "./instrumentation.ts";

const MAP_READ = 0x0001;
const COPY_DST = 0x0008;

/** Copy `source[0, bytes)` into a free slot, if any is free and a listener is
 * registered; returns the post-submit map callback, else undefined. */
export type StatusReadback = (
  encoder: GPUCommandEncoder,
  source: GPUBuffer,
  generation: number,
) => (() => void) | undefined;

/**
 * `report` receives the mapped bytes for the generation copied. It is never
 * called while no staging slot is free or no listener is registered, and is
 * silently dropped if this allocation owner retired before the map resolved.
 * Busy staging slots are destroyed only after their submitted map settles.
 */
export function useStatusReadback(
  bytes: number,
  label: string,
  report: ((data: ArrayBuffer, generation: number) => void) | undefined,
): StatusReadback {
  const device = useDeviceContext();
  const staging = useMemo(
    () =>
      [0, 1].map(() =>
        device.createBuffer({
          size: Math.max(16, bytes),
          usage: MAP_READ | COPY_DST,
          label: `molgpu:${label}`,
        })
      ),
    [device, bytes, label],
  );
  // Allocation-local state cannot be reactivated by a replacement owner.
  const state = useMemo(() => ({ alive: true, busy: [false, false] }), [
    staging,
  ]);
  const reportRef = useRef<typeof report>(report);
  reportRef.current = report;
  useResource((dispose) => {
    for (const buffer of staging) trackOwnedBuffer(buffer, label);
    state.alive = true;
    dispose(() => {
      state.alive = false;
      staging.forEach((buffer, slot) => {
        releaseOwnedBuffer(buffer);
        // A submitted copy/map owns a busy slot until its completion.
        if (!state.busy[slot]) buffer.destroy();
      });
    });
  }, [staging]);
  return (encoder, source, generation) => {
    if (!state.alive) return;
    const slot = state.busy.indexOf(false);
    if (!reportRef.current || slot < 0) return;
    const target = staging[slot];
    state.busy[slot] = true;
    encoder.copyBufferToBuffer(source, 0, target, 0, bytes);
    return () => {
      const finish = () => {
        state.busy[slot] = false;
        if (!state.alive) target.destroy();
      };
      target.mapAsync(MAP_READ).then(() => {
        try {
          if (!state.alive) return;
          const data = target.getMappedRange().slice(0);
          reportRef.current?.(data, generation);
        } finally {
          target.unmap();
          finish();
        }
      }, finish);
    };
  };
}
