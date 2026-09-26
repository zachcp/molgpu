import { useMemo } from "@use-gpu/live";
import { atomRadii } from "@molgpu/table";
import { toAtoms, type SelectionQuery } from "@molgpu/select";
import { focusSelection } from "./camera-curve.ts";
import { useStructureResource } from "./structure-context.ts";
import { useCoordinateBounds } from "./use-coordinate-bounds.ts";
import { useCoordinateSelection } from "./use-coordinate-selection.ts";
import type { FocusOptions, FocusResult } from "./types.ts";

/** Nonblocking focus for the nearest coordinate stream and a reusable query. */
export function useCoordinateFocus(
  query: SelectionQuery,
  options: FocusOptions = {},
): FocusResult | null {
  const resource = useStructureResource();
  const resolved = useCoordinateSelection(query);
  const selection = useMemo(() => resolved
    ? toAtoms(resolved, resource.data) : null, [resolved, resource]);
  const bounds = useCoordinateBounds(selection);
  const { empty = "structure", fov = Math.PI / 3, aspect = 1,
    padding = 1.15, atomRadiusScale = 1 } = options;
  return useMemo(() => {
    if (!bounds || !selection) return focusSelection(resource, query, options);
    if (!selection.indices.length) {
      if (empty === "null") return null;
      if (empty === "error") throw new RangeError("focus selection is empty");
    }
    const radii = atomRadii(resource.data);
    let maxRadius = 0;
    for (const row of selection.indices) {
      maxRadius = Math.max(maxRadius, radii[row] * atomRadiusScale);
    }
    const { instances } = resource.data.topology;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let instance = 0; instance < instances.count; instance++) {
      const matrix = instances.transform.subarray(instance * 16, instance * 16 + 16);
      for (let corner = 0; corner < 8; corner++) {
        const x = bounds.min[0] + ((corner & 1) ? bounds.max[0] - bounds.min[0] : 0);
        const y = bounds.min[1] + ((corner & 2) ? bounds.max[1] - bounds.min[1] : 0);
        const z = bounds.min[2] + ((corner & 4) ? bounds.max[2] - bounds.min[2] : 0);
        for (let axis = 0; axis < 3; axis++) {
          const center = matrix[axis] * x + matrix[axis + 4] * y +
            matrix[axis + 8] * z + matrix[axis + 12];
          const extent = maxRadius * Math.hypot(
            matrix[axis], matrix[axis + 4], matrix[axis + 8],
          );
          lo[axis] = Math.min(lo[axis], center - extent);
          hi[axis] = Math.max(hi[axis], center + extent);
        }
      }
    }
    if (!instances.count) {
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = bounds.min[axis] - maxRadius;
        hi[axis] = bounds.max[axis] + maxRadius;
      }
    }
    const center = lo.map((value, axis) => (value + hi[axis]) / 2);
    const half = lo.map((value, axis) => (hi[axis] - value) / 2);
    const halfFovX = Math.atan(Math.tan(fov / 2) * aspect);
    return Object.freeze({
      target: Object.freeze(center),
      radius: Math.max(0.01, Math.hypot(...half) * padding /
        Math.sin(Math.min(halfFovX, fov / 2))),
      bounds: Object.freeze({
        min: Object.freeze(lo), max: Object.freeze(hi), center: Object.freeze(center),
      }),
    }) as FocusResult;
  }, [resource, query, bounds, selection, empty, fov, aspect, padding, atomRadiusScale]);
}
