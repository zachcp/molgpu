import { useMemo } from "@use-gpu/live";
import { atomRadii } from "@molgpu/table";
import { all, resolve, where } from "@molgpu/select";
import { useStructureResource } from "./structure-context.ts";
import { useCoordinateBounds } from "./use-coordinate-bounds.ts";
import { useSelectionInput } from "./internal/use-selection-input.ts";
import type { FocusOptions, FocusResult, SelectionInput } from "./types.ts";

/** Nonblocking focus for nearest coordinates and molecular membership.
 * Queries use 4 Hz/on-pause snapshots with latest-published consistency;
 * pending/error membership or unavailable bounds returns null without root fallback.
 */
export function useCoordinateFocus(
  query: SelectionInput,
  options: FocusOptions = {},
): FocusResult | null {
  const resource = useStructureResource();
  const resolved = useSelectionInput(
    query,
    "useCoordinateFocus",
    "focus",
    options,
  );
  const selection = resolved.status === "ready" ? resolved.selection : null;
  const emptyRows = useMemo(
    () => resolve(where("atom", "pending focus", () => false), resource.data),
    [
      resource,
    ],
  );
  const {
    empty = "structure",
    fov = Math.PI / 3,
    aspect = 1,
    padding = 1.15,
    atomRadiusScale = 1,
  } = options;
  if (
    !Number.isFinite(fov) || fov <= 0 || fov >= Math.PI ||
    !Number.isFinite(aspect) || aspect <= 0 ||
    !Number.isFinite(padding) || padding <= 0 ||
    !Number.isFinite(atomRadiusScale) || atomRadiusScale < 0
  ) throw new RangeError("invalid camera framing options");
  const defaultRows = useMemo(() =>
    resolve(all(), resource.data, {
      view: { model: "first", altloc: "primary" },
    }), [resource]);
  const framingSelection =
    selection && !selection.indices.length && empty === "structure"
      ? defaultRows
      : selection;
  const bounds = useCoordinateBounds(framingSelection ?? emptyRows);
  return useMemo(() => {
    if (!selection) return null;
    if (!selection.indices.length && empty !== "structure") {
      if (empty === "error") throw new RangeError("focus selection is empty");
      return null;
    }
    if (!bounds || !framingSelection) return null;
    const radii = atomRadii(resource.data);
    let maxRadius = 0;
    for (const row of framingSelection.indices) {
      maxRadius = Math.max(maxRadius, radii[row] * atomRadiusScale);
    }
    const { instances } = resource.data.topology;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let instance = 0; instance < instances.count; instance++) {
      const matrix = instances.transform.subarray(
        instance * 16,
        instance * 16 + 16,
      );
      for (let corner = 0; corner < 8; corner++) {
        const x = bounds.min[0] +
          ((corner & 1) ? bounds.max[0] - bounds.min[0] : 0);
        const y = bounds.min[1] +
          ((corner & 2) ? bounds.max[1] - bounds.min[1] : 0);
        const z = bounds.min[2] +
          ((corner & 4) ? bounds.max[2] - bounds.min[2] : 0);
        for (let axis = 0; axis < 3; axis++) {
          const center = matrix[axis] * x + matrix[axis + 4] * y +
            matrix[axis + 8] * z + matrix[axis + 12];
          const extent = maxRadius * Math.hypot(
            matrix[axis],
            matrix[axis + 4],
            matrix[axis + 8],
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
      radius: Math.max(
        0.01,
        Math.hypot(...half) * padding /
          Math.sin(Math.min(halfFovX, fov / 2)),
      ),
      bounds: Object.freeze({
        min: Object.freeze(lo),
        max: Object.freeze(hi),
        center: Object.freeze(center),
      }),
    }) as FocusResult;
  }, [
    resource,
    query,
    bounds,
    selection,
    framingSelection,
    empty,
    fov,
    aspect,
    padding,
    atomRadiusScale,
  ]);
}
