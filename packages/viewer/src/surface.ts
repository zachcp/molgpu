import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
  ViewerElement,
} from "./types.ts";
import { use, useMemo } from "@use-gpu/live";
import { FaceLayer } from "@use-gpu/workbench";
import { activeAtoms } from "@molgpu/table";
import { useStructure } from "./structure-context.ts";
import { type ColumnSpec, withColumns } from "./internal/representation.ts";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { withMaterial } from "./materials.ts";
import { useGeometryJob } from "./use-geometry-job.ts";
import { buildSurfaceGeometry } from "./internal/surface-geometry.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { count } from "./internal/instrumentation.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

/**
 * A molecular (solvent-excluded) surface: Mol*'s scalar-field kernel lifted
 * through @molgpu/io, extracted with @molgpu/geo's marching-cubes port, and
 * drawn via FaceLayer. `select` (a @molgpu/select atom Selection) restricts
 * which atoms build the surface; without one, the active model/primary-
 * altloc atoms are used. `probeRadius`/`resolution` are the only geometry
 * parameters — changing either rebuilds the field and mesh (routed through
 * 0sj.7's useGeometryJob, so a rapid parameter change displays only the
 * latest result and unmounting cancels outstanding work); `color`/`opacity`
 * are separate FaceLayer bindings and never do. An oversize grid throws an
 * actionable error (see internal/geometry-job.ts's assertGridBudget)
 * before the field is computed, not after. Each vertex carries the atom row
 * it is nearest to (`sourceAtom` on the raw geometry, not yet surfaced as a
 * prop here — picking/field colouring is future work built on top of it).
 * `material` (a @molgpu/viewer material spec) wraps the shaded face layer;
 * without one the surface uses the ambient scene material.
 */
export const Surface: ViewerComponent<
  {
    /** A @molgpu/select atom Selection; without one, active model/primary-altloc atoms are used. */
    select?: Selection | null;
    /** Ångström probe radius; defaults to 1.4 (water). */
    probeRadius?: number;
    /** Grid spacing in Ångströms; defaults to 0.5. Smaller is finer and slower. */
    resolution?: number;
    /** Grid byte budget override; defaults to 256 MiB. */
    maxBytes?: number;
    color?: VectorLike;
    /** Wraps the shaded face layer; without one, the ambient scene material. */
    material?: MaterialSpec;
    loading?: ViewerElement | (() => ViewerElement);
    error?: ViewerElement | ((failure: unknown) => ViewerElement);
  } & Translucency
> = (
  {
    select,
    probeRadius = 1.4,
    resolution = 0.5,
    maxBytes,
    color = [0.75, 0.75, 0.8, 1],
    opacity = 1,
    mode,
    material,
    loading = null,
    error = null,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("surface", color, opacity);
  checkOpacity(opacity, "Surface");
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
    throw new TypeError("Surface received a foreign or non-atom selection");
  }
  const selectKey = select?.id ?? "active";
  // activeAtoms is a topology-only view policy: coordinate edits keep it.
  const indices = useMemo(
    () =>
      select
        ? select.indices
        : (count("topologyBuilds", "surface:activeAtoms"), activeAtoms(data)),
    [resource.identity, resource.topologyRevision, selectKey],
  );
  const params = useMemo(
    () => ({ indices, probeRadius, resolution, maxBytes }),
    [indices, probeRadius, resolution, maxBytes],
  );
  const [mesh, failure, pending] = useGeometryJob(
    resource,
    params,
    buildSurfaceGeometry,
  );

  if (pending) return typeof loading === "function" ? loading() : loading;
  if (failure) return typeof error === "function" ? error(failure) : error;
  if (!mesh?.vertexCount) return null;

  const specs: ColumnSpec[] = [
    { key: "positions", data: mesh.positions, format: "vec3<f32>" },
    { key: "normals", data: mesh.normals, format: "vec3<f32>" },
    { key: "indices", data: mesh.indices, format: "u32" },
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
