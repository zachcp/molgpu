import {
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
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
  children: LiveElement;
}> = ({ upstream, source, generation, children }) => {
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
    resource: upstream.resource,
    mayStartUnfilled: true,
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
  const output = () => {
    return use(Compute, {
      immediate: true,
      children: use(Kernel, {
        shader,
        source: upstream.source,
        sources: linked,
        args,
        initial: true,
        version: generation,
        size: [upstream.count, 1],
      }),
    });
  };
  return use(ComputeBuffer, {
    width: upstream.count * 3,
    height: 1,
    format: "f32",
    label: "molgpu:coords:provider",
    children: output,
    then: (source: StorageTarget) =>
      use(Published, { upstream, source, generation, children }),
  });
};
