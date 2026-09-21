// Scheduling contract for expensive, cancellable geometry work (surface
// fields/meshes and any future off-main-thread build), independent of the
// pure kernels it runs (@molgpu/geo). Deliberately reuses the same
// cancellation idiom as structure.mjs/use-annotation.mjs: an async function
// takes a `cancelled()` check and its result is discarded, never mounted, if
// cancelled becomes true before it resolves. `useGeometryJob` (below) wires
// this to @use-gpu/live's `useAwait`, whose per-dependency-change and
// per-unmount `dispose()` already sets that flag — see its use in
// structure.mjs for the same guarantee this module extends to geometry jobs.
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
const STYLE_KEYS = new Set(['color', 'opacity']);

const fail = message => { throw new TypeError(`Geometry job: ${message}`); };

/**
 * Dependency key for scheduling: structure identity/revisions plus explicit
 * geometry parameters (isoLevel, resolution, probe radius, ...). Style
 * parameters must never gate scheduling, so passing one here is a
 * programming error, not a silently-ignored input: color/opacity edits must
 * update bindings only and launch zero jobs.
 */
export function geometryDeps(resource, params = {}) {
  if (!resource?.identity) fail('expected a structure resource with an identity');
  const keys = Object.keys(params).sort();
  for (const key of keys) if (STYLE_KEYS.has(key)) fail(`'${key}' is a style parameter and must not gate geometry scheduling`);
  return [resource.identity, resource.topologyRevision, resource.positionsRevision, ...keys.map(k => params[k])];
}

/** Cell/byte budget for a scalar grid, checked before allocating it. */
export function assertGridBudget(dims, { maxBytes = DEFAULT_MAX_BYTES, bytesPerCell = 4 } = {}) {
  if (!Array.isArray(dims) || dims.length !== 3 || dims.some(n => !Number.isInteger(n) || n < 1)) {
    fail('dims must contain three positive integers');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('maxBytes must be a positive safe integer');
  const cells = dims[0] * dims[1] * dims[2];
  const bytes = cells * bytesPerCell;
  if (bytes > maxBytes) {
    const error = new RangeError(`Geometry job: grid ${dims.join('x')} (${cells} cells, ${bytes} bytes) exceeds the ${maxBytes} byte limit`);
    error.code = 'GEOMETRY_BUDGET_EXCEEDED';
    throw error;
  }
  return bytes;
}

/** An owned copy, so a job can outlive or transform data without risking a shared/detached buffer still owned by Structure. */
export function copyOwned(typedArray) {
  return typedArray.slice();
}

/**
 * Run a (possibly async) geometry kernel under the shared cancellation
 * contract. The kernel stays a plain function of pure kernels; this only
 * decides whether its result still matters by the time it settles.
 */
export async function runGeometryJob(kernel, cancelled) {
  const result = await kernel();
  return cancelled() ? null : result;
}
