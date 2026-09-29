// Demand-driven, rate-limited readback of one GPU buffer, shared by coordinate
// and volume snapshots. Two staging buffers alternate so a new copy never
// waits on the previous map.
import { type LC, useMemo, useRef, useResource } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./instrumentation.ts";

const noop = () => {};
const MAP_READ = 0x0001;
const COPY_DST = 0x0008;

/**
 * Copy `buffer[0, bytes)` to the CPU whenever `generation` changes, at most
 * `maxHz` times a second. With `onPause` the last generation after motion stops
 * is always read (within about 34 ms). A copy that lands after its generation
 * was superseded is discarded, and the newest generation is scheduled next.
 * Counters are recorded under `<label>:dispatch|publish|discard|error`.
 */
export const ThrottledReadback: LC<{
  buffer: GPUBuffer;
  bytes: number;
  generation: number;
  maxHz: number;
  onPause: boolean;
  label: string;
  publish: (data: Float32Array, generation: number) => void;
}> = ({ buffer, bytes, generation, maxHz, onPause, label, publish }) => {
  const device = useDeviceContext();
  const latest = useRef({ buffer, generation, publish, maxHz, onPause });
  latest.current = { buffer, generation, publish, maxHz, onPause };
  const inFlight = useRef(false);
  const mapping = useRef<GPUBuffer | null>(null);
  const retired = useRef(new Set<GPUBuffer>());
  const destroy = (buffer: GPUBuffer) => {
    releaseOwnedBuffer(buffer);
    buffer.destroy();
  };
  const published = useRef(-1);
  const lastDispatch = useRef(-Infinity);
  const nextBuffer = useRef(0);
  const staging = useMemo(() =>
    [0, 1].map(() =>
      device.createBuffer({
        size: Math.max(4, bytes),
        usage: COPY_DST | MAP_READ,
        label: `molgpu:${label}`,
      })
    ), [device, bytes, buffer]);
  useResource((dispose) => {
    for (const b of staging) trackOwnedBuffer(b, label);
    dispose(() => {
      for (const b of staging) {
        if (mapping.current === b) retired.current.add(b);
        else destroy(b);
      }
    });
  }, [staging]);
  // A readback can outlive the effect that started it: a new generation
  // disposes the effect while the copy is in flight. The copy then publishes
  // if it is still current, and hands off to the latest effect's scheduler;
  // otherwise nothing would ever schedule the new generation.
  const mounted = useRef(true);
  const kick = useRef<() => void>(noop);
  useResource((dispose) => {
    mounted.current = true;
    dispose(() => {
      mounted.current = false;
    });
  }, []);
  useResource((dispose) => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!alive || inFlight.current) return;
      const { generation: current, maxHz: rate, onPause: pause } =
        latest.current;
      if (current === published.current) return;
      const remaining = 1000 / rate -
        (performance.now() - lastDispatch.current);
      // The pause request supplies the last frame after motion stops.
      const delay = pause
        ? Math.min(Math.max(0, remaining), 34)
        : Math.max(0, remaining);
      timer = setTimeout(async () => {
        if (!alive || inFlight.current) return;
        const { buffer: source, generation: target } = latest.current;
        const into = staging[nextBuffer.current++ % staging.length];
        inFlight.current = true;
        mapping.current = into;
        lastDispatch.current = performance.now();
        count("gathers", `${label}:dispatch`);
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(source, 0, into, 0, bytes);
          device.queue.submit([encoder.finish()]);
          await into.mapAsync(MAP_READ);
          const values = new Float32Array(into.getMappedRange().slice(0));
          into.unmap();
          if (!mounted.current) return;
          if (target === latest.current.generation) {
            published.current = target;
            latest.current.publish(values, target);
            count("gathers", `${label}:publish`);
          } else count("gathers", `${label}:discard`);
        } catch {
          if (mounted.current) count("gathers", `${label}:error`);
        } finally {
          mapping.current = null;
          if (retired.current.delete(into)) destroy(into);
          inFlight.current = false;
          if (mounted.current) kick.current();
        }
      }, Math.max(0, delay));
    };
    kick.current = schedule;
    schedule();
    dispose(() => {
      alive = false;
      if (timer) clearTimeout(timer);
    });
  }, [device, staging, generation, maxHz, onPause]);
  return null;
};
