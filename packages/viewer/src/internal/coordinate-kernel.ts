import { useDispatchObservation } from "./dispatch-observation.ts";
import {
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
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
 * on unmount, as the nearest coordinates for `children`.
 *
 * Pass `ready`, or `dispatched` (the latest generation whose dispatch was
 * encoded). With `dispatched`, `ready` means this buffer has been written at
 * least once: a later generation's dispatch is submitted before the frame's
 * draws, so drawing stays on (per-generation readiness hid every live
 * consumer for a render on each trajectory frame). The CPU snapshot
 * still waits until the published generation itself was dispatched, so a
 * readback is never labelled with a generation the buffer does not hold. */
export const Published: LC<{
  upstream: Coordinates;
  source: Pick<StorageTarget, "buffer">;
  generation: number;
  ready?: boolean;
  dispatched?: number;
  children: LiveElement;
}> = ({ upstream, source, generation, dispatched, children, ...props }) => {
  // The first generation this buffer can hold: a reallocated output starts
  // unwritten even if an earlier buffer was dispatched.
  const since = useMemo(() => generation, [source.buffer]);
  const ready = dispatched === undefined
    ? props.ready ?? false
    : dispatched >= since;
  const current = dispatched === undefined ? ready : dispatched === generation;
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
      current,
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
 * per dispatch and CPU snapshots below it. Until the first dispatch into its
 * output lands, descendants see `ready: false`; later generations keep it true.
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
  const observe = useDispatchObservation(generation, setDispatchedGeneration);
  const output = () => {
    return use(Compute, {
      immediate: true,
      children: upstream.ready === false ? null : observe(
        use(Kernel, {
          shader,
          source: upstream.source,
          sources: linked,
          args,
          initial: true,
          version: generation,
          size: [upstream.count, 1],
        }),
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
        dispatched: dispatchedGeneration,
        children,
      }),
  });
};
