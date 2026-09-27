import {
  gather,
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
  yeet,
} from "@use-gpu/live";
import type { StorageSource, StorageTarget } from "@use-gpu/core";
import type { ShaderModule } from "@use-gpu/shader";
import {
  Compute,
  ComputeBuffer,
  Kernel,
  LoopContext,
} from "@use-gpu/workbench";
import {
  type Coordinates,
  CoordinatesContext,
} from "../coordinates-context.ts";
import { CoordinateSnapshotBoundary } from "../coordinate-snapshot.ts";
import {
  gauge,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./instrumentation.ts";

const NONE: readonly StorageSource[] = [];

/** Publish a provider's packed output buffer, which it now owns and destroys
 * on unmount, as the nearest coordinates for `children`. */
export const Published: LC<{
  upstream: Coordinates;
  source: Pick<StorageTarget, "buffer">;
  generation: number;
  ready: boolean;
  children: LiveElement;
}> = ({ upstream, source, generation, ready, children }) => {
  const requestRepaint = useContext(LoopContext);
  // ComputeBuffer's f32 target is packed; the vec3to4 accessor reconstructs
  // logical vec3 rows without imposing WGSL's 16-byte array<vec3> stride.
  const packed = useMemo<StorageSource>(() => ({
    buffer: source.buffer,
    format: "vec3to4<f32>",
    length: upstream.count,
    size: [upstream.count, 1],
    version: generation,
  }), [source.buffer, upstream.count, generation]);
  useResource((dispose) => {
    trackOwnedBuffer(source.buffer, "coords:provider");
    gauge("coords:provider:bytes", source.buffer.size);
    // Pipeline creation is asynchronous. A bounded set of wakeups prevents a
    // first draw from staying on the zero-filled buffer after the dispatch lands.
    const wakeups = [16, 50, 100, 200, 400, 800].map((delay) =>
      setTimeout(requestRepaint, delay)
    );
    dispose(() => {
      for (const wakeup of wakeups) clearTimeout(wakeup);
      releaseOwnedBuffer(source.buffer);
      source.buffer.destroy();
    });
  }, [source.buffer]);
  const coordinates = Object.freeze({
    source: packed,
    count: upstream.count,
    generation,
    ready,
    resource: upstream.resource,
  });
  return provide(
    CoordinatesContext,
    coordinates,
    use(CoordinateSnapshotBoundary, {
      coordinates,
      children,
    }),
  );
};

/** Own one packed output and publish it after one generation-gated dispatch. */
export const CoordinateKernel: LC<{
  upstream: Coordinates;
  shader: ShaderModule;
  args?: unknown[];
  /** Extra storage inputs, linked after `args` and before the upstream source.
   * Memoized by element identity so the kernel does not re-link per render. */
  sources?: readonly StorageSource[];
  parameterKey: string;
  children: LiveElement;
}> = (
  { upstream, shader, args = [], sources = NONE, parameterKey, children },
) => {
  const linked = useMemo(() => [...sources], [...sources]);
  const next = useRef(0);
  const generation = useMemo(() => ++next.current, [
    upstream.source,
    upstream.generation,
    shader,
    parameterKey,
    ...sources,
  ]);
  const [dispatchedGeneration, setDispatchedGeneration] = useState(-1);
  const notified = useRef(-1);
  const ready = dispatchedGeneration === generation;
  const output = () => {
    return use(Compute, {
      immediate: true,
      children: upstream.ready === false ? null : gather(
        use(Kernel, {
          shader,
          source: upstream.source,
          sources: linked,
          args,
          initial: true,
          version: generation,
          size: [upstream.count, 1],
        }),
        (calls: { compute?: (...args: unknown[]) => unknown }[]) => {
          const call = calls.find((item) => item?.compute);
          return call?.compute
            ? yeet({
              compute: (...args: unknown[]) => {
                const result = call.compute!(...args);
                if (notified.current !== generation) {
                  notified.current = generation;
                  queueMicrotask(() => setDispatchedGeneration(generation));
                }
                return result;
              },
            })
            : null;
        },
      ),
    });
  };
  return use(ComputeBuffer, {
    width: upstream.count * 3,
    height: 1,
    format: "f32",
    label: "molgpu:coords:provider",
    children: output,
    then: (source: StorageTarget) =>
      use(Published, {
        upstream,
        source,
        generation: generation * 2 + Number(ready),
        ready,
        children,
      }),
  });
};
