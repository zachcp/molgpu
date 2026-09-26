import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "./types.ts";
import { use, useMemo } from "@use-gpu/live";
import { LineLayer } from "@use-gpu/workbench";
import { traceTable } from "@molgpu/table";
import { useStructure } from "./structure-context.ts";
import { useCoordinateSnapshot } from "./coordinate-snapshot.ts";
import {
  type ColumnSpec,
  useActiveRows,
  withColumns,
} from "./internal/representation.ts";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { withMaterial } from "./materials.ts";
import { buildTubeGeometry } from "./internal/tube-geometry.ts";
import { lineWidthForRadius } from "./internal/line-size.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { count } from "./internal/instrumentation.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

/**
 * Draw the polymer backbone as a GPU-extruded tube: RawLines' shaded mode
 * (@use-gpu/wgsl/geometry/tube via LineLayer), zero CPU mesh building.
 * `select` (a @molgpu/select atom Selection) restricts which atoms feed the
 * trace; without one, the active model/primary-altloc atoms are used, never
 * every altloc conformer at once (which would jumble the guide path).
 * Missing residues, chain/model breaks, and a selection that drops a
 * residue's guide atom all end a run rather than being bridged across.
 * `radius` is an Ångström tube radius, converted through the verified
 * depth:-1 LineLayer width contract (internal/line-size.mjs) with no
 * empirical floor. Only `select` and `smooth` (samples per guide segment)
 * rebuild the trace/spline geometry; `radius` and `color` update bindings.
 */
export const Tube: ViewerComponent<
  {
    /** A @molgpu/select atom Selection; without one, active model/primary-altloc atoms are used. */
    select?: Selection | null;
    /** Ångström tube radius; defaults to 0.3. */
    radius?: number;
    /** Samples per guide segment; defaults to 6. */
    smooth?: number;
    color?: VectorLike;
    sides?: number;
    join?: "tangent" | "bevel" | "miter" | "round";
    /** Wraps the shaded tube layer; without one, the ambient scene material. */
    material?: MaterialSpec;
  } & Translucency
> = (
  {
    select,
    radius = 0.3,
    sides = 8,
    join = "round",
    smooth = 6,
    color = [0.45, 0.78, 0.95, 1],
    opacity = 1,
    mode,
    material,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("tube", color, opacity, radius);
  checkOpacity(opacity, "Tube");
  const drawColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
  const drawMode = modeProps(mode, flatAlpha(color, false) * opacity);
  const { resource } = useStructure();
  const data = useCoordinateSnapshot()?.data;

  const indices = useActiveRows(resource, select, "Tube");
  const trace = useMemo(
    () =>
      data
        ? (count("geometryBuilds", "tube:trace"), traceTable(data, indices))
        : null,
    [data, indices],
  );
  const built = useMemo(() => trace ? buildTubeGeometry(trace, smooth) : null, [
    trace,
    smooth,
  ]);
  if (!built?.count) return null;

  const width = lineWidthForRadius(radius, -1);
  const specs: ColumnSpec[] = [
    { key: "positions", data: built.positions, format: "vec3<f32>" },
    { key: "segments", data: built.segments, format: "i32" },
  ];
  return withColumns(specs, (map) =>
    withMaterial(
      material,
      use(LineLayer, {
        positions: map.positions,
        segments: map.segments,
        width,
        color: drawColor,
        shaded: true,
        sides,
        join,
        depth: -1,
        ...drawMode,
        ...props,
      }),
    ));
};
