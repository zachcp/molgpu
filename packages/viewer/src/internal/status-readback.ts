// Double-buffered, epoch-guarded readback of one small fixed-size status
// buffer, shared by <Superpose> and <Unwrap>. Two staging buffers alternate
// so a new copy never waits on the previous map; an epoch guard discards a
// map that resolves after this owner unmounted.
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
 * silently dropped if this owner unmounted before the map resolved.
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
  const alive = useRef(true);
  const busy = useRef([false, false]);
  const epoch = useRef(0);
  const reportRef = useRef<typeof report>(report);
  reportRef.current = report;
  useResource((dispose) => {
    for (const buffer of staging) trackOwnedBuffer(buffer, label);
    epoch.current++;
    alive.current = true;
    busy.current = [false, false];
    dispose(() => {
      epoch.current++;
      alive.current = false;
      for (const buffer of staging) {
        releaseOwnedBuffer(buffer);
        buffer.destroy();
      }
    });
  }, [staging]);
  return (encoder, source, generation) => {
    const slot = busy.current.indexOf(false);
    if (!reportRef.current || slot < 0) return;
    const target = staging[slot];
    const readEpoch = epoch.current;
    busy.current[slot] = true;
    encoder.copyBufferToBuffer(source, 0, target, 0, bytes);
    return () => {
      target.mapAsync(MAP_READ).then(() => {
        if (epoch.current !== readEpoch) return;
        const data = target.getMappedRange().slice(0);
        target.unmap();
        busy.current[slot] = false;
        if (!alive.current) return;
        reportRef.current?.(data, generation);
      }, () => {
        if (epoch.current !== readEpoch) return;
        busy.current[slot] = false;
      });
    };
  };
}
