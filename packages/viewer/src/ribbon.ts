import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "./types.ts";
import { use, useMemo } from "@use-gpu/live";
import { FaceLayer } from "@use-gpu/workbench";
import {
  activeAtoms,
  secondaryStructureTrace,
  traceTable,
} from "@molgpu/table";
import { useStructure } from "./structure-context.ts";
import { type ColumnSpec, withColumns } from "./internal/representation.ts";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { withMaterial } from "./materials.ts";
import { buildRibbonGeometry } from "./internal/ribbon-geometry.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { count } from "./internal/instrumentation.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

/**
 * Draw the polymer backbone as a flat, oriented ribbon: a CPU-extruded
 * cross-section (0sj.1's curve-segment kernel, oriented by 0sj.2's
 * per-residue direction/secondary-structure data) fed to FaceLayer as a
 * mesh. `select` (a @molgpu/select atom Selection) restricts which atoms
 * feed the trace, same as <Tube>; missing residues, chain/model breaks, and
 * a selection that drops a residue's guide atom all end a run rather than
 * bridging across it.
 *
 * Scope, deliberate: helix/sheet residues get a wide cross-section, coil a
 * narrow one, but there is no beta-strand arrowhead taper yet — a flat
 * ribbon throughout, not the full cartoon vocabulary. Only `select` and
 * `smooth` (samples per guide segment) rebuild the trace/spline geometry;
 * `color`/`opacity` update bindings.
 */
export const Ribbon: ViewerComponent<
  {
    /** A @molgpu/select atom Selection; without one, active model/primary-altloc atoms are used. */
    select?: Selection | null;
    /** Samples per guide segment; defaults to 8. */
    smooth?: number;
    color?: VectorLike;
    /** Wraps the shaded ribbon layer; without one, the ambient scene material. */
    material?: MaterialSpec;
  } & Translucency
> = (
  {
    select,
    smooth = 8,
    color = [0.85, 0.55, 0.35, 1],
    opacity = 1,
    mode,
    material,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("ribbon", color, opacity);
  checkOpacity(opacity, "Ribbon");
  const drawColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
  const drawMode = modeProps(mode, flatAlpha(color, false) * opacity);
  const { resource } = useStructure();
  const { data } = resource;

  if (
    select !== undefined && select !== null &&
    (select.dataset !== resource.identity || select.domain !== "atom")
  ) {
    throw new TypeError("Ribbon received a foreign or non-atom selection");
  }
  const selectKey = select?.id ?? "active";
  // activeAtoms is a topology-only view policy: coordinate edits keep it.
  const indices = useMemo(
    () =>
      select
        ? select.indices
        : (count("topologyBuilds", "ribbon:activeAtoms"), activeAtoms(data)),
    [resource.identity, resource.topologyRevision, selectKey],
  );
  const trace = useMemo(
    () => (count("geometryBuilds", "ribbon:trace"), traceTable(data, indices)),
    [data, indices],
  );
  const ss = useMemo(
    () => (count("geometryBuilds", "ribbon:ss"),
      secondaryStructureTrace(data, indices, trace)),
    [data, indices, trace],
  );
  const built = useMemo(() => buildRibbonGeometry(trace, ss, smooth), [
    trace,
    ss,
    smooth,
  ]);
  if (!built.vertexCount) return null;

  const specs: ColumnSpec[] = [
    { key: "positions", data: built.positions, format: "vec3<f32>" },
    { key: "normals", data: built.normals, format: "vec3<f32>" },
    { key: "indices", data: built.indices, format: "u32" },
  ];
  return withColumns(specs, (map) =>
    withMaterial(
      material,
      use(FaceLayer, {
        positions: map.positions,
        normals: map.normals,
        indices: map.indices,
        color: drawColor,
        shaded: true,
        side: "both",
        ...drawMode,
        ...props,
      }),
    ));
};
