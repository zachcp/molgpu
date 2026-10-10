import { ioLoader, useSourceRequest } from "../internal/source-request.ts";
import type {
  StructureLoader,
  StructureProps,
  ViewerComponent,
} from "../types.ts";
import { use } from "@use-gpu/live";
import { StructureProvider } from "./structure-context.ts";

const defaultLoader: StructureLoader = ioLoader((io, src, signal) =>
  io.structureFromBcif(src, { signal })
);

/**
 * Own a preloaded StructureData or load one BCIF source. It intentionally
 * creates no renderer, so it nests under the caller's existing use.gpu scene.
 */
export const Structure: ViewerComponent<StructureProps> = (
  {
    data,
    src,
    loader = defaultLoader,
    loading = null,
    error = null,
    children,
  },
) => {
  if (data !== undefined && src !== undefined) {
    throw new TypeError("<Structure> accepts either data or src, not both");
  }
  if (data === undefined && src === undefined) {
    throw new TypeError("<Structure> requires data or src");
  }
  if (src !== undefined && typeof src !== "string") {
    throw new TypeError("<Structure> src must be a string");
  }
  if (typeof loader !== "function") {
    throw new TypeError("<Structure> loader must be a function");
  }
  // async, so a loader that throws synchronously still reaches the error prop.
  const request = useSourceRequest(
    data === undefined
      ? async (signal: AbortSignal) =>
        await loader(src!, () => signal.aborted, signal)
      : null,
    [data, src, loader],
  );
  if (data !== undefined) {
    return (use(StructureProvider, { data, children: children }));
  }
  // Replacing src marks the request pending again, so the previously loaded
  // structure cannot flash back while its successor is still in flight.
  if (request.state === "pending") {
    return typeof loading === "function" ? loading() : loading;
  }
  if (request.state === "rejected") {
    return typeof error === "function" ? error(request.error) : error;
  }
  // A cancelled request resolves to null and must not mount stale content.
  const loaded = request.state === "resolved" ? request.value : null;
  return loaded
    ? (use(StructureProvider, {
      data: loaded,
      children: children,
    }))
    : null;
};
