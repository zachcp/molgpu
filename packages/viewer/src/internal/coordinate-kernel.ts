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
    dispose(() => {
      releaseOwnedBuffer(source.buffer);
      source.buffer.destroy();
    });
  }, [source.buffer]);
  useResource(() => {
    if (ready) requestRepaint();
  }, [ready]);
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

/** `<CoordinateKernel>` props. */
export interface CoordinateKernelProps {
  /** The coordinates to transform: `useCoordinates()` of the nearest provider. */
  upstream: Coordinates;
  /**
   * A WGSL compute module run once per atom (`@workgroup_size(64)`). It links
   * `getSize()`, then one getter per `args` entry, one per `sources` entry, and
   * `getInput(i) -> vec3<f32>` for the upstream position, and writes
   * `output[i * 3u + k]` for k = 0, 1, 2.
   */
  shader: ShaderModule;
  /** Uniform values linked in order after `getSize`. */
  args?: unknown[];
  /** Extra storage inputs, linked after `args` and before the upstream source.
   * Memoized by element identity so the kernel does not re-link per render. */
  sources?: readonly StorageSource[];
  /** Change it whenever `args` or `sources` change the output, so the
   * published generation advances and snapshots refresh. */
  parameterKey: string;
  children: LiveElement;
}

/**
 * Write a GPU coordinate transform: run `shader` over the upstream positions
 * into one packed buffer this component owns (destroyed on unmount) and publish
 * it as the nearest coordinates for `children`, with a generation that advances
 * per dispatch and CPU snapshots below it. Until the first dispatch lands,
 * descendants see `ready: false`.
 */
export const CoordinateKernel: LC<CoordinateKernelProps> = (
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
  const mounted = useRef(true);
  useResource((dispose) => {
    mounted.current = true;
    dispose(() => {
      mounted.current = false;
    });
  }, []);
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
        // Kernel yields one compute call, and only once its pipeline has
        // compiled. Wrap it to learn when this generation's dispatch lands;
        // Compute's multiGather needs a single object, not an array.
        (calls: { compute?: (...args: unknown[]) => unknown }[]) => {
          const call = calls.find((item) => item?.compute);
          return call?.compute
            ? yeet({
              compute: (
                pass: unknown,
                countDispatch: (...args: number[]) => void,
              ) => {
                let dispatched = false;
                const result = call.compute!(pass, (...counts: number[]) => {
                  dispatched = true;
                  countDispatch(...counts);
                });
                // ComputePass submits synchronously after this call returns.
                // Kernel's initial guard can suppress a call, so only the
                // count callback establishes that encoding reached dispatch.
                if (dispatched && notified.current !== generation) {
                  notified.current = generation;
                  queueMicrotask(() => {
                    if (mounted.current) setDispatchedGeneration(generation);
                  });
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
        generation,
        ready,
        children,
      }),
  });
};
