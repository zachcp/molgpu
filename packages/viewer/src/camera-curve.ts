import { resolve, type SelectionQuery, toAtoms } from "@molgpu/select";
import { createCurve, sample } from "@molgpu/timeline";
import { atomRadii, type StructureData } from "@molgpu/table";
import { gauge } from "./internal/instrumentation.ts";
import type {
  CameraCurve,
  CameraFrame,
  CameraPose,
  FocusCameraFrame,
  FocusOptions,
  FocusResult,
  StructureBounds,
  StructureResource,
} from "./types.ts";

type Framings = Map<string, FocusResult | null>;
type AnyFrame = CameraFrame | FocusCameraFrame;

const finite = (value: unknown, name: string): void => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
};
const point = (value: unknown, name: string): number[] => {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${name} must be a three-number vector`);
  }
  value.forEach((v: unknown, i: number) => finite(v, `${name}[${i}]`));
  return [...value];
};
const focusCache = new WeakMap<
  StructureResource,
  WeakMap<SelectionQuery, Framings>
>();
// Framings per (resource, query). The options key includes the continuous
// `aspect`, so a resizing canvas would otherwise add an entry per size: keep
// the most recently used ones.
const MAX_FRAMINGS = 64;
const remember = <V extends FocusResult | null>(
  byOptions: Framings,
  key: string,
  value: V,
): V => {
  byOptions.delete(key);
  byOptions.set(key, value);
  if (byOptions.size > MAX_FRAMINGS) {
    byOptions.delete(byOptions.keys().next().value!);
  }
  gauge("focusCacheOptions", byOptions.size);
  return value;
};

/** Framing bounds include displayed atom radii and every assembly instance. */
const displayBounds = (
  data: StructureData,
  indices: Uint32Array,
  atomRadiusScale: number,
): StructureBounds | null => {
  const { atoms, residues, instances } = data.topology;
  const radii = atomRadii(data);
  if (!indices.length) return null;
  const byChain = new Map<number, Float64Array[]>();
  for (let i = 0; i < instances.count; i++) {
    const chain = instances.chain[i];
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain)!.push(instances.transform.subarray(i * 16, i * 16 + 16));
  }
  const identity = Float64Array.of(
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  );
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const i of indices) {
    const chain = residues.chain[atoms.residue[i]];
    const transforms = byChain.get(chain) ?? [identity];
    const x = data.positions[i * 3],
      y = data.positions[i * 3 + 1],
      z = data.positions[i * 3 + 2];
    const r = radii[i] * atomRadiusScale;
    for (const m of transforms) {
      for (let axis = 0; axis < 3; axis++) {
        const center = m[axis] * x + m[axis + 4] * y + m[axis + 8] * z +
          m[axis + 12];
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
export function focusSelection(
  resource: StructureResource,
  query: SelectionQuery,
  options: FocusOptions = {},
): FocusResult | null {
  const {
    empty = "structure",
    fov = Math.PI / 3,
    aspect = 1,
    padding = 1.15,
    atomRadiusScale = 1,
  } = options;
  if (!resource?.data || typeof resource.dispose !== "function") {
    throw new TypeError("focusSelection requires a StructureResource");
  }
  if (!query || typeof query.type !== "string") {
    throw new TypeError("focusSelection requires a reusable SelectionQuery");
  }
  if (!["structure", "null", "error"].includes(empty)) {
    throw new TypeError("empty must be structure, null, or error");
  }
  for (
    const [name, value] of Object.entries({
      fov,
      aspect,
      padding,
      atomRadiusScale,
    })
  ) finite(value, name);
  if (
    fov <= 0 || fov >= Math.PI || aspect <= 0 || padding < 1 ||
    atomRadiusScale < 0
  ) {
    throw new RangeError("invalid camera framing options");
  }
  // A resource owns immutable structure data for one exact set of revisions.
  // Query results remain reusable while scrubbing this resource, but a swap or
  // coordinate update creates a new resource and therefore a fresh cache.
  void resource.bounds; // also rejects a disposed resource before any cache hit
  let byQuery = focusCache.get(resource);
  if (!byQuery) focusCache.set(resource, byQuery = new WeakMap());
  let byOptions = byQuery.get(query);
  if (!byOptions) byQuery.set(query, byOptions = new Map());
  const cacheKey = `${empty}|${fov}|${aspect}|${padding}|${atomRadiusScale}`;
  if (byOptions.has(cacheKey)) {
    return remember(
      byOptions,
      cacheKey,
      byOptions.get(cacheKey) as FocusResult | null,
    );
  }
  const data = resource.data;
  let indices = toAtoms(resolve(query, data), data).indices;
  if (!indices.length) {
    if (empty === "error") throw new RangeError("focus selection is empty");
    if (empty === "null") return remember(byOptions, cacheKey, null);
    indices = Uint32Array.from(
      { length: data.topology.atoms.count },
      (_, i) => i,
    );
  }
  const bounds = displayBounds(data, indices, atomRadiusScale);
  if (!bounds) {
    return remember(
      byOptions,
      cacheKey,
      Object.freeze({
        target: Object.freeze([0, 0, 0]),
        radius: 5,
        bounds: null,
      }),
    );
  }
  const half = bounds.max.map((v, i) => (v - bounds.min[i]) / 2);
  const sphereRadius = Math.hypot(...half);
  const halfFovY = fov / 2;
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  const radius = Math.max(
    0.01,
    sphereRadius * padding / Math.sin(Math.min(halfFovX, halfFovY)),
  );
  const frozenBounds = Object.freeze({
    min: Object.freeze(bounds.min),
    max: Object.freeze(bounds.max),
    center: Object.freeze(bounds.center),
  });
  // Frozen at runtime; the public FocusResult type predates readonly arrays.
  return remember(
    byOptions,
    cacheKey,
    Object.freeze({
      target: frozenBounds.center,
      radius,
      bounds: frozenBounds,
    }) as FocusResult,
  );
}

/** Camera frames may target a fixed point/radius or a reusable focus query.
 * Focus is resolved only in sampleCamera, never when the curve is created. */
export function createCameraCurve(frames: CameraCurve): CameraCurve {
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new TypeError("camera curve needs at least two frames");
  }
  let previous = -Infinity;
  return Object.freeze(frames.map((frame: AnyFrame, i): AnyFrame => {
    finite(frame?.time, `frame ${i} time`);
    if (frame.time <= previous) {
      throw new RangeError("camera frame times must increase");
    }
    previous = frame.time;
    finite(frame.bearing, `frame ${i} bearing`);
    finite(frame.pitch, `frame ${i} pitch`);
    if ("focus" in frame && frame.focus) {
      if (
        frame.target !== undefined || frame.radius !== undefined ||
        typeof frame.focus.type !== "string"
      ) {
        throw new TypeError(
          "camera frame focus must be a query without target or radius",
        );
      }
    } else {
      point(frame.target, `frame ${i} target`);
      finite(frame.radius, `frame ${i} radius`);
      if ((frame.radius as number) <= 0) {
        throw new RangeError("camera radius must be positive");
      }
    }
    return Object.freeze({
      ...frame,
      target: frame.target &&
        Object.freeze(point(frame.target, `frame ${i} target`)),
    }) as AnyFrame;
  }));
}

/** Pure arbitrary-time camera sample. A current StructureResource is explicit;
 * swapping it or advancing positions changes focused endpoints immediately. */
export function sampleCamera(
  curve: CameraCurve,
  time: number,
  resource: StructureResource,
  options?: FocusOptions,
): CameraPose {
  finite(time, "sample time");
  const resolved = curve.map((frame) => {
    const view = "focus" in frame && frame.focus
      ? focusSelection(resource, frame.focus, options)
      : frame as CameraFrame;
    if (!view) {
      throw new RangeError(
        "camera focus returned null; use empty:structure for an empty query",
      );
    }
    return { ...frame, target: view.target, radius: view.radius };
  });
  const scalar = (
    key: "radius" | "bearing" | "pitch",
    type: "number" | "angle" = "number",
  ) =>
    createCurve(
      resolved.map((frame) => ({
        time: frame.time,
        value: frame[key] as number,
        ease: frame.ease,
        bezier: frame.bezier,
      })),
      { type },
    );
  const target = createCurve(resolved.map((frame) => ({
    time: frame.time,
    value: frame.target as readonly number[],
    ease: frame.ease,
    bezier: frame.bezier,
  })));
  return {
    target: sample(target, time),
    radius: sample(scalar("radius"), time),
    bearing: sample(scalar("bearing", "angle"), time),
    pitch: sample(scalar("pitch"), time),
  };
}
