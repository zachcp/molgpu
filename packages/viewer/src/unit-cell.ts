// <UnitCell>: the periodic box of the frame the nearest <Trajectory> shows,
// drawn as its twelve edges from the origin.
import type { VectorLike, ViewerComponent } from "./types.ts";
import { use, useMemo } from "@use-gpu/live";
import { LineLayer } from "@use-gpu/workbench";
import { useTrajectoryFrame } from "./trajectory.ts";
import { type ColumnSpec, withColumns } from "./internal/representation.ts";
import { applyOpacity, checkOpacity, modeProps } from "./internal/opacity.ts";
import { viewer } from "./internal/elements.ts";

// Each edge is its own open line: 1 = start, 2 = end.
const SEGMENTS = Int32Array.from({ length: 24 }, (_, i) => i % 2 ? 2 : 1);

/** Endpoints of the 12 edges of the parallelepiped spanned by box columns. */
export function boxEdges(box: ArrayLike<number>): Float32Array {
  const col = (c: number) => [box[c * 3], box[c * 3 + 1], box[c * 3 + 2]];
  const corner = (i: number, j: number, k: number) =>
    [0, 1, 2].map((r) => i * col(0)[r] + j * col(1)[r] + k * col(2)[r]);
  const out: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const from = [0, 0, 0], to = [0, 0, 0];
      const others = [0, 1, 2].filter((a) => a !== axis);
      from[others[0]] = to[others[0]] = u;
      from[others[1]] = to[others[1]] = v;
      to[axis] = 1;
      out.push(
        ...corner(from[0], from[1], from[2]),
        ...corner(to[0], to[1], to[2]),
      );
    }
  }
  return Float32Array.from(out);
}

/**
 * Draw the displayed frame's periodic box (see `useTrajectoryFrame().box`)
 * as lines. Renders nothing outside a `<Trajectory>` or when the frames on
 * screen carry no box.
 */
export const UnitCell: ViewerComponent<{
  color?: VectorLike;
  width?: number;
  opacity?: number;
}> = ({ color = [1, 1, 1, 1], width = 2, opacity = 1 }) => {
  const box = useTrajectoryFrame()?.box ?? null;
  checkOpacity(opacity, "UnitCell");
  const lineColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
  const key = box ? box.join() : "";
  const specs = useMemo((): ColumnSpec[] | null =>
    box
      ? [
        { key: "positions", data: boxEdges(box), format: "vec3<f32>" },
        { key: "segments", data: SEGMENTS, format: "i32" },
      ]
      : null, [key]);
  if (!specs) return null;
  const mode = modeProps(
    undefined,
    (color.length > 3 ? color[3] : 1) * opacity,
  );
  return viewer(withColumns(specs, (map) =>
    use(LineLayer, {
      positions: map.positions,
      segments: map.segments,
      width,
      color: lineColor,
      join: "round",
      ...mode,
    })));
};
