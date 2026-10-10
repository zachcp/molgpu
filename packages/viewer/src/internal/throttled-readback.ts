// Demand-driven, rate-limited readback shared by coordinate, attribute and
// volume snapshots. Publication uses the source token captured at copy time.
import { type LC, useMemo, useRef, useResource } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./instrumentation.ts";
import { type ReadbackToken, sameReadbackToken } from "./readback-token.ts";

const noop = () => {};
const MAP_READ = 0x0001;
const COPY_DST = 0x0008;

/** Copy the latest eligible revision, retaining rate limiting and final-on-pause. */
export const ThrottledReadback: LC<{
  token: ReadbackToken;
  /** The source holds this token's generation; retain scheduling while pending. */
  ready?: boolean;
  maxHz: number;
  onPause: boolean;
  label: string;
  publish: (data: Float32Array, token: ReadbackToken) => boolean;
  fail?: (error: unknown, token: ReadbackToken) => void;
}> = ({ token, ready = true, maxHz, onPause, label, publish, fail }) => {
  const device = useDeviceContext();
  const latest = useRef({ token, ready, publish, fail, maxHz, onPause });
  latest.current = { token, ready, publish, fail, maxHz, onPause };
  const inFlight = useRef(false);
  const mapping = useRef<GPUBuffer | null>(null);
  const retired = useRef(new Set<GPUBuffer>());
  const destroy = (buffer: GPUBuffer) => {
    releaseOwnedBuffer(buffer);
    buffer.destroy();
  };
  const published = useRef<ReadbackToken | null>(null);
  const lastDispatch = useRef(-Infinity);
  const nextBuffer = useRef(0);
  const staging = useMemo(() =>
    [0, 1].map(() =>
      device.createBuffer({
        size: Math.max(4, token.bytes),
        usage: COPY_DST | MAP_READ,
        label: `molgpu:${label}`,
      })
    ), [device, token.buffer, token.bytes]);
  useResource((dispose) => {
    for (const b of staging) trackOwnedBuffer(b, label);
    dispose(() => {
      for (const b of staging) {
        if (mapping.current === b) retired.current.add(b);
        else destroy(b);
      }
    });
  }, [staging]);
  // A mapped copy can outlive its scheduling effect. Its completion hands off
  // to the newest effect after rejecting any superseded source token.
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
      if (!alive || inFlight.current || !latest.current.ready) return;
      const { token: current, maxHz: rate, onPause: pause } = latest.current;
      if (sameReadbackToken(published.current, current)) return;
      const remaining = 1000 / rate -
        (performance.now() - lastDispatch.current);
      // The pause request supplies the last frame after motion stops.
      const delay = pause
        ? Math.min(Math.max(0, remaining), 34)
        : Math.max(0, remaining);
      timer = setTimeout(async () => {
        if (!alive || inFlight.current || !latest.current.ready) return;
        const target = latest.current.token;
        const into = staging[nextBuffer.current++ % staging.length];
        inFlight.current = true;
        mapping.current = into;
        lastDispatch.current = performance.now();
        count("gathers", `${label}:dispatch`);
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(target.buffer, 0, into, 0, target.bytes);
          device.queue.submit([encoder.finish()]);
          await into.mapAsync(MAP_READ);
          const values = new Float32Array(into.getMappedRange().slice(0));
          into.unmap();
          if (!mounted.current) return;
          if (
            latest.current.ready &&
            sameReadbackToken(target, latest.current.token)
          ) {
            if (latest.current.publish(values, target)) {
              published.current = target;
              count("gathers", `${label}:publish`);
            }
          } else count("gathers", `${label}:discard`);
        } catch (error) {
          if (mounted.current) {
            count("gathers", `${label}:error`);
            latest.current.fail?.(error, target);
          }
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
  }, [
    device,
    staging,
    token.owner,
    token.buffer,
    token.bytes,
    token.layout,
    token.generation,
    ready,
    maxHz,
    onPause,
  ]);
  return null;
};
