import type { Selection } from "@molgpu/select";
import { compile, type Field } from "@molgpu/fields";
import { createVolumeGrid } from "@molgpu/table";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
  ViewerElement,
} from "./types.ts";
import { type LC, use, useMemo } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";
import { FaceLayer, useShader, useShaderRef } from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { useStructure } from "./structure-context.ts";
import { useCoordinateSnapshot } from "./coordinate-snapshot.ts";
import {
  type ColumnSpec,
  isField,
  useActiveRows,
  withColumns,
} from "./internal/representation.ts";
import { useField } from "./use-field.ts";
import { useOpacityColors } from "./internal/use-opacity-colors.ts";
import { live } from "./internal/elements.ts";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { withMaterial } from "./internal/with-material.ts";
import { useGeometryJob } from "./use-geometry-job.ts";
import { buildSurfaceGeometry } from "./internal/surface-geometry.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

// A vertex pushed `offset` Å along its normal: where a surface colour field
// samples, so moving the sampling shell is a uniform write.
const OFFSET_POSITIONS = wgsl`
@link fn getPosition(i: u32) -> vec3<f32>;
@link fn getNormal(i: u32) -> vec3<f32>;
@link fn getOffset() -> f32;
@export fn getOffsetPosition(i: u32) -> vec3<f32> {
  return getPosition(i) + normalize(getNormal(i)) * getOffset();
}
`;

/**
 * Surface vertices are not atoms: a colour field may only read position
 * (e.g. `volumeSample`/`byPotential`), plus constants and the timeline.
 */
const PROBE_GRID = createVolumeGrid({
  dims: [2, 2, 2],
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});
function checkVertexField(field: Field): void {
  // Compiled only to list its inputs; any grid will do for that.
  const reads = compile(field, {
    target: "link",
    domain: "atom",
    volume: PROBE_GRID,
  }).bindings
    .map((b) => b.id)
    .filter((id) =>
      id !== "positions" && id !== "curve:t" && !id.startsWith("volume:")
    );
  if (reads.length) {
    throw new TypeError(
      `Surface colour fields may read only position (volumeSample, byPotential), not ${
        reads.join(", ")
      }; per-atom surface colouring is not supported`,
    );
  }
}

const FieldFaces: LC<{
  field: Field;
  positions: StorageSource;
  normals: StorageSource;
  sampleOffset: number;
  opacity: number;
  render: (colors: ShaderSource) => ReturnType<typeof live>;
}> = ({ field, positions, normals, sampleOffset, opacity, render }) => {
  const offset = useShaderRef(sampleOffset);
  const shell = useShader(OFFSET_POSITIONS, [positions, normals, offset]);
  const inputs = useMemo(() => ({ positions: shell }), [shell]);
  const colors = useOpacityColors(
    useField(field, inputs, { domain: "atom" }),
    opacity,
  );
  return render(colors);
};

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
 *
 * `color` may be a Field that reads only position, such as `byPotential()`
 * under `<EField>`: each vertex samples it `sampleOffset` Å out along its
 * normal (default 1.4, one water radius, as ChimeraX's coulombic colouring),
 * live as the volume changes. Moving the offset is a uniform write. The mesh
 * itself follows coordinate snapshots (4 Hz and on pause), so under playback
 * the colour can sample a newer frame than the mesh shows.
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
    /** A flat colour, or a position-only Field such as `byPotential()`. */
    color?: VectorLike | Field;
    /** Å along the vertex normal where a colour field samples; default 1.4. */
    sampleOffset?: number;
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
    sampleOffset = 1.4,
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
  const field = isField(color) ? color : null;
  if (field) checkVertexField(field);
  if (!Number.isFinite(sampleOffset)) {
    throw new TypeError("Surface sampleOffset must be finite");
  }
  const drawColor = useMemo(
    () => field ? [1, 1, 1, 1] : applyOpacity(color as VectorLike, opacity),
    [field, color, opacity],
  );
  const drawMode = modeProps(mode, flatAlpha(color, !!field) * opacity);
  const { resource } = useStructure();
  const snapshot = useCoordinateSnapshot();
  const indices = useActiveRows(resource, select, "Surface");
  const params = useMemo(
    () => ({ indices, probeRadius, resolution, maxBytes }),
    [indices, probeRadius, resolution, maxBytes],
  );
  const [mesh, failure, pending] = useGeometryJob(
    snapshot?.resource ?? null,
    params,
    buildSurfaceGeometry,
  );

  if (!snapshot || pending) {
    return typeof loading === "function" ? loading() : loading;
  }
  if (failure) return typeof error === "function" ? error(failure) : error;
  if (!mesh?.vertexCount) return null;

  const specs: ColumnSpec[] = [
    { key: "positions", data: mesh.positions, format: "vec3<f32>" },
    { key: "normals", data: mesh.normals, format: "vec3<f32>" },
    { key: "indices", data: mesh.indices, format: "u32" },
  ];
  const faces = (
    map: Record<string, StorageSource | null>,
    colors?: ShaderSource,
  ) =>
    withMaterial(
      material,
      use(FaceLayer, {
        positions: map.positions!,
        normals: map.normals!,
        indices: map.indices!,
        color: drawColor,
        ...(colors ? { colors } : {}),
        shaded: true,
        side: "both",
        ...drawMode,
        ...props,
      }),
    );
  return withColumns(specs, (map) =>
    field
      ? use(FieldFaces, {
        field,
        positions: map.positions!,
        normals: map.normals!,
        sampleOffset,
        opacity,
        render: (colors: ShaderSource) => live(faces(map, colors)),
      })
      : faces(map));
};
