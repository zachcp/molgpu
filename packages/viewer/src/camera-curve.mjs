import { resolve, toAtoms } from '@molgpu/select';
import { createCurve, sample } from '@molgpu/timeline';
import { gauge } from './internal/instrumentation.mjs';

const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
};
const point = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${name} must be a three-number vector`);
  value.forEach((v, i) => finite(v, `${name}[${i}]`));
  return [...value];
};
const focusCache = new WeakMap();

/** Framing bounds include displayed atom radii and every assembly instance. */
const displayBounds = (data, indices, atomRadiusScale) => {
  const { atoms, residues, instances } = data.topology;
  if (!indices.length) return null;
  const byChain = new Map();
  for (let i = 0; i < instances.count; i++) {
    const chain = instances.chain[i];
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain).push(instances.transform.subarray(i * 16, i * 16 + 16));
  }
  const identity = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of indices) {
    const chain = residues.chain[atoms.residue[i]];
    const transforms = byChain.get(chain) ?? [identity];
    const x = data.positions[i * 3], y = data.positions[i * 3 + 1], z = data.positions[i * 3 + 2];
    const r = (atoms.radius?.[i] ?? 0) * atomRadiusScale;
    for (const m of transforms) {
      for (let axis = 0; axis < 3; axis++) {
        const center = m[axis] * x + m[axis + 4] * y + m[axis + 8] * z + m[axis + 12];
        const extent = r * Math.hypot(m[axis], m[axis + 4], m[axis + 8]);
        min[axis] = Math.min(min[axis], center - extent);
        max[axis] = Math.max(max[axis], center + extent);
      }
    }
  }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2) };
};

/** Resolve a reusable query against the current resource at evaluation time.
 * Empty queries focus the whole structure by default; an empty structure yields
 * the explicit neutral camera. Pass empty:'null' for a no-op result instead. */
export function focusSelection(resource, query, {
  empty = 'structure', fov = Math.PI / 3, aspect = 1, padding = 1.15, atomRadiusScale = 1,
} = {}) {
  if (!resource?.data || !resource?.accepts) throw new TypeError('focusSelection requires a StructureResource');
  if (!query || typeof query.type !== 'string') throw new TypeError('focusSelection requires a reusable SelectionQuery');
  if (!['structure', 'null', 'error'].includes(empty)) throw new TypeError('empty must be structure, null, or error');
  for (const [name, value] of Object.entries({ fov, aspect, padding, atomRadiusScale })) finite(value, name);
  if (fov <= 0 || fov >= Math.PI || aspect <= 0 || padding < 1 || atomRadiusScale < 0)
    throw new RangeError('invalid camera framing options');
  // A resource owns immutable structure data for one exact set of revisions.
  // Query results remain reusable while scrubbing this resource, but a swap or
  // coordinate update creates a new resource and therefore a fresh cache.
  void resource.bounds; // also rejects a disposed resource before any cache hit
  let byQuery = focusCache.get(resource);
  if (!byQuery) focusCache.set(resource, byQuery = new WeakMap());
  let byOptions = byQuery.get(query);
  if (!byOptions) byQuery.set(query, byOptions = new Map());
  const cacheKey = `${empty}|${fov}|${aspect}|${padding}|${atomRadiusScale}`;
  if (byOptions.has(cacheKey)) return byOptions.get(cacheKey);
  const data = resource.data;
  let indices = toAtoms(resolve(query, data), data).indices;
  if (!indices.length) {
    if (empty === 'error') throw new RangeError('focus selection is empty');
    if (empty === 'null') { byOptions.set(cacheKey, null); return null; }
    indices = Uint32Array.from({ length: data.topology.atoms.count }, (_, i) => i);
  }
  resource.selection(indices); // validates the explicit handle is still live
  const bounds = displayBounds(data, indices, atomRadiusScale);
  if (!bounds) {
    const neutral = Object.freeze({ target: Object.freeze([0, 0, 0]), radius: 5, bounds: null });
    byOptions.set(cacheKey, neutral);
    return neutral;
  }
  const half = bounds.max.map((v, i) => (v - bounds.min[i]) / 2);
  const sphereRadius = Math.hypot(...half);
  const halfFovY = fov / 2;
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  const radius = Math.max(0.01, sphereRadius * padding / Math.sin(Math.min(halfFovX, halfFovY)));
  const frozenBounds = Object.freeze({
    min: Object.freeze(bounds.min), max: Object.freeze(bounds.max), center: Object.freeze(bounds.center),
  });
  const view = Object.freeze({ target: frozenBounds.center, radius, bounds: frozenBounds });
  byOptions.set(cacheKey, view);
  gauge('focusCacheOptions', byOptions.size);
  return view;
}

/** Camera frames may target a fixed point/radius or a reusable focus query.
 * Focus is resolved only in sampleCamera, never when the curve is created. */
export function createCameraCurve(frames) {
  if (!Array.isArray(frames) || frames.length < 2) throw new TypeError('camera curve needs at least two frames');
  let previous = -Infinity;
  return Object.freeze(frames.map((frame, i) => {
    finite(frame?.time, `frame ${i} time`);
    if (frame.time <= previous) throw new RangeError('camera frame times must increase');
    previous = frame.time;
    finite(frame.bearing, `frame ${i} bearing`);
    finite(frame.pitch, `frame ${i} pitch`);
    if (frame.focus) {
      if (frame.target !== undefined || frame.radius !== undefined || typeof frame.focus.type !== 'string')
        throw new TypeError('camera frame focus must be a query without target or radius');
    } else {
      point(frame.target, `frame ${i} target`);
      finite(frame.radius, `frame ${i} radius`);
      if (frame.radius <= 0) throw new RangeError('camera radius must be positive');
    }
    return Object.freeze({ ...frame, target: frame.target && Object.freeze(point(frame.target, `frame ${i} target`)) });
  }));
}

/** Pure arbitrary-time camera sample. A current StructureResource is explicit;
 * swapping it or advancing positions changes focused endpoints immediately. */
export function sampleCamera(curve, time, resource, focusOptions) {
  finite(time, 'sample time');
  const resolved = curve.map((frame) => {
    const view = frame.focus ? focusSelection(resource, frame.focus, focusOptions) : frame;
    if (!view) throw new RangeError('camera focus returned null; use empty:structure for an empty query');
    return { ...frame, target: view.target, radius: view.radius };
  });
  const frames = (key, type = 'number') => createCurve(resolved.map((frame) => ({
    time: frame.time, value: frame[key], ease: frame.ease, bezier: frame.bezier,
  })), { type });
  return {
    target: sample(frames('target'), time),
    radius: sample(frames('radius'), time),
    bearing: sample(frames('bearing', 'angle'), time),
    pitch: sample(frames('pitch'), time),
  };
}
