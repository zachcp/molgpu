import { useAwait } from "@use-gpu/live";
import type { StructureResource } from "./types.ts";
import { geometryDeps, runGeometryJob } from "./internal/geometry-job.ts";

/**
 * Schedule an expensive, cancellable geometry build (a surface field/mesh, or
 * any similarly costly derivation) keyed on structure identity/revisions plus
 * explicit geometry `params`. Relies on `useAwait`'s existing guarantees
 * (see structure.ts): a dependency change or unmount disposes the previous
 * call and marks it cancelled, so a superseded build never mounts even if it
 * resolves last, and unmounting cancels outstanding work. `params` must hold
 * geometry-affecting values only (isoLevel, resolution, ...) — passing a
 * style key (color, opacity) throws rather than silently rescheduling
 * geometry on a style edit. `kernel` is a plain `(resource, params) =>
 * result` function of pure @molgpu/geo kernels; it may return a promise.
 *
 * Returns `[result, error, pending]`; `result` is null while loading, on
 * failure, or once superseded.
 */
export function useGeometryJob<P extends Record<string, unknown>, T>(
  resource: StructureResource | null,
  params: P,
  kernel: (resource: StructureResource, params: P) => T | Promise<T>,
): readonly [T | null | undefined, unknown, boolean] {
  return useAwait(
    resource ? (cancelled: () => boolean) =>
      runGeometryJob(() => kernel(resource, params), cancelled) : null,
    resource ? geometryDeps(resource, params ?? {}) as unknown[] : [null],
  );
}
