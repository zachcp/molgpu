// Position bounds for use.gpu's OIT draws. OITPass weighs each fragment by its
// depth within the near/far range of every `mode: "oit"` draw's position
// bounds, and warns about a draw without them. CPU columns carry bounds from
// RawData; GPU position sources (live coordinates, volume lattices) get an
// extent here. The pass's OIT target is not visible to scene components in
// use.gpu 0.21.0, so "oit" is the caller's explicit mode, as on a layer.
import type { DataBounds } from "@use-gpu/core";
import { toDataBounds } from "@use-gpu/core";
import { useMemo } from "@use-gpu/live";
import type { Field } from "@molgpu/fields";
import type { DrawMode, VectorLike } from "../types.ts";
import { applyOpacity, checkOpacity, flatAlpha, modeProps } from "./opacity.ts";
import { isField } from "./representation.ts";

const WHITE = Object.freeze([1, 1, 1, 1]);

/**
 * A representation's translucency inputs, validated once: the colour Field
 * (if any), the flat colour to bind (white under a Field, whose per-vertex
 * `colors` win), and the layer draw mode from flat alpha × opacity.
 */
export function useTranslucency(
  who: string,
  color: VectorLike | Field,
  opacity: number,
  mode: DrawMode | undefined,
): {
  field: Field | null;
  drawColor: VectorLike;
  drawMode: { mode?: DrawMode };
} {
  checkOpacity(opacity, who);
  const field = isField(color) ? color : null;
  const drawColor = useMemo(
    () => field ? WHITE : applyOpacity(color as VectorLike, opacity),
    [field, color, opacity],
  ) as VectorLike;
  return {
    field,
    drawColor,
    drawMode: modeProps(mode, flatAlpha(color, !!field) * opacity),
  };
}

/** An axis-aligned world box. */
export interface Box {
  readonly min: ArrayLike<number>;
  readonly max: ArrayLike<number>;
}

/** `box` grown by `pad` on every side, as use.gpu bounds. */
export const paddedBounds = (box: Box, pad: number): DataBounds =>
  toDataBounds({
    min: [0, 1, 2].map((i) => box.min[i] - pad),
    max: [0, 1, 2].map((i) => box.max[i] + pad),
  });

/** The world box of a grid's corners under its column-major index affine. */
export function gridBox(
  dims: readonly number[],
  transform: ArrayLike<number>,
): Box {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const g = [0, 1, 2].map((a) => (c >> a) & 1 ? dims[a] - 1 : 0);
    for (let r = 0; r < 3; r++) {
      const v = transform[r] * g[0] + transform[4 + r] * g[1] +
        transform[8 + r] * g[2] + transform[12 + r];
      min[r] = Math.min(min[r], v);
      max[r] = Math.max(max[r], v);
    }
  }
  return { min, max };
}

/** Bounds for an OIT draw: `box` grown by `pad`; null for other modes. */
export function useOitBounds(
  drawMode: { mode?: DrawMode },
  box: Box | null | undefined,
  pad = 0,
): DataBounds | null {
  const oit = drawMode.mode === "oit";
  return useMemo(
    () => oit && box ? paddedBounds(box, pad) : null,
    [oit, box, pad],
  );
}

/** `positions` carrying `bounds`, unless it has its own or `bounds` is null. */
export function useBoundedPositions<T extends object>(
  positions: T,
  bounds: DataBounds | null | undefined,
): T {
  return useMemo(
    () =>
      !bounds || (positions as { bounds?: unknown }).bounds
        ? positions
        : { ...positions, bounds },
    [positions, bounds],
  );
}
