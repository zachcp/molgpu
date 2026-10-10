import type { SelectionDiagnostics, SelectionInput } from "../../types.ts";
import { SelectionConsumer } from "../../selection/selection-consumer.ts";
import type { Selection } from "@molgpu/select";
import type { Field } from "@molgpu/fields";
import type { StructureData } from "@molgpu/table";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
  ViewerElement,
} from "../../types.ts";
import { type LC, use, useContext, useMemo } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";
import { FaceLayer, useShader, useShaderRef } from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import {
  StructureContext,
  useStructure,
} from "../../structure/structure-context.ts";
import { useCoordinates } from "../../coordinates/coordinates-context.ts";
import { atomRadii } from "@molgpu/table";
import { useGpuSurface } from "./use-gpu-surface.ts";
import { useCoordinateSnapshot } from "../../coordinates/coordinate-snapshot.ts";
import {
  type ColumnSpec,
  isField,
  useActiveRows,
  withColumns,
} from "../../rendering/representation.ts";
import { useField } from "../../field-binding/use-field.ts";
import { useOpacityColors } from "../../rendering/use-opacity-colors.ts";

import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "../../rendering/opacity.ts";
import { withMaterial } from "../../rendering/with-material.ts";
import {
  CopyDraws,
  withGeometryCopies,
} from "../../rendering/instance-copies.ts";
import { useGeometryJob } from "../../internal/use-geometry-job.ts";
import { buildSurfaceGeometry } from "./surface-geometry.ts";
import { useRepaint } from "../../internal/use-repaint.ts";
import { useBindingProbe } from "../../internal/use-binding-probe.ts";
import { useAttributeSources } from "../../field-binding/attribute-sources.ts";
import {
  fieldColumns,
  type FieldPlan,
  useFieldPlan,
} from "../../field-binding/use-field-plan.ts";

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

// Surface vertices sample positions directly, and atom columns and
// annotation rows through the nearest source atom recorded when the mesh is
// built.
const FieldFaces: LC<{
  field: Field;
  positions: StorageSource;
  normals: StorageSource;
  sourceAtom: StorageSource | null;
  annotation: StorageSource | null;
  data: StructureData;
  plan: FieldPlan;
  sampleOffset: number;
  opacity: number;
  render: (colors: ShaderSource) => ViewerElement;
}> = (
  {
    field,
    positions,
    normals,
    sourceAtom,
    annotation,
    data,
    plan,
    sampleOffset,
    opacity,
    render,
  },
) => {
  const offset = useShaderRef(sampleOffset);
  const shell = useShader(OFFSET_POSITIONS, [positions, normals, offset]);
  const attributes = useAttributeSources(data, plan.attrNames);
  const keys = plan.attrNames.map((name) => `attr:${name}`);
  const inputs = useMemo(() => ({
    positions: shell,
    ...fieldColumns(
      plan,
      attributes.sources,
      attributes.domains,
      annotation,
      sourceAtom,
    ),
  }), [
    shell,
    sourceAtom,
    annotation,
    plan,
    ...keys.map((key) => attributes.sources[key]),
    ...keys.map((key) => attributes.domains[key]),
  ]);
  const colors = useOpacityColors(
    useField(field, inputs, { domain: "atom" }),
    opacity,
  );
  return attributes.ready ? render(colors) : null;
};

/** Rolling probe (Å) that smooths the accessible surface's sphere seams. */
const ACCESSIBLE_SMOOTHING = 0.25;

/**
 * A molecular (solvent-excluded, or with `kind: "accessible"` solvent-
 * accessible) surface: Mol*'s scalar-field kernel lifted
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
 * it is nearest to (`sourceAtom`), used for atom-attribute colour fields.
 * `material` (a @molgpu/viewer material spec) wraps the shaded face layer;
 * without one the surface uses the ambient scene material.
 *
 * `color` may read atom or lifted residue attributes such as `byElement()`,
 * annotation rows, or position such as `byPotential()` under `<EField>`:
 * atom inputs come from each vertex's nearest source atom, and position-based
 * inputs are sampled `sampleOffset` Å out along its
 * normal (default 1.4, one water radius, as ChimeraX's coulombic colouring),
 * live as the volume changes. Moving the offset is a uniform write.
 *
 * Root coordinates build the mesh once on the CPU (Mol*'s field). Live
 * coordinates — a coordinate provider or trajectory below the structure —
 * rebuild it on the GPU from each coordinate generation, without a CPU
 * readback: one build runs at a time, the newest generation is queued behind
 * it, and the last finished mesh stays drawn meanwhile, so under playback the
 * mesh can lag the colour by a build. A probe radius below two resolution
 * steps, or an atom with an unusually dense neighbourhood, keeps the CPU build
 * from coordinate snapshots (normally 4 Hz, including the final revision) instead; so does the
 * accessible kind, whose smoothing probe is below that bound.
 */
const SurfaceResolved: ViewerComponent<
  {
    /** A molecular query or exact atom selection. Defaults to first-model/primary-altloc atoms. */
    select?: Selection | null;
    /** "excluded" (default): the solvent-excluded surface a `probeRadius`
     * sphere rolls out. "accessible": the solvent-accessible surface, the
     * union of atoms grown by `probeRadius`, which closes channels the probe
     * fits through. */
    kind?: "excluded" | "accessible";
    /** Ångström probe radius; defaults to 1.4 (water). */
    probeRadius?: number;
    /** Grid spacing in Ångströms; defaults to 0.5. Smaller is finer and slower. */
    resolution?: number;
    /** Grid byte budget override; defaults to 256 MiB. */
    maxBytes?: number;
    /** A flat colour or an atom/position Field such as `byElement()` or `byPotential()`. */
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
    kind = "excluded",
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
  if (!Number.isFinite(sampleOffset)) {
    throw new TypeError("Surface sampleOffset must be finite");
  }
  const drawColor = useMemo(
    () => field ? [1, 1, 1, 1] : applyOpacity(color as VectorLike, opacity),
    [field, color, opacity],
  );
  const drawMode = modeProps(mode, flatAlpha(color, !!field) * opacity);
  const { resource } = useStructure();
  const plan = useFieldPlan(field, resource, "Surface");
  const indices = useActiveRows(resource, select, "Surface");
  // Live coordinates (a provider or trajectory below the root) rebuild on the
  // GPU from every generation; root coordinates build once on the CPU, which
  // is also the fallback where the GPU port does not apply.
  const coordinates = useCoordinates();
  const root = useContext(StructureContext);
  const live = !!coordinates &&
    (coordinates.source !== root?.sources?.positions ||
      coordinates.generation !== resource.positionsRevision);
  if (kind !== "excluded" && kind !== "accessible") {
    throw new TypeError("Surface kind must be 'excluded' or 'accessible'");
  }
  // The accessible surface is the excluded surface of atoms grown by the
  // probe, rolled by a small smoothing probe instead of the solvent one.
  const accessible = kind === "accessible";
  const fieldProbe = accessible ? ACCESSIBLE_SMOOTHING : probeRadius;
  const inflate = accessible ? probeRadius : 0;
  const radii = useMemo(() => {
    const base = atomRadii(resource.data);
    return inflate ? base.map((r) => r + inflate) : base;
  }, [resource.data.topology, inflate]);
  const request = useMemo(
    () => ({
      rows: indices,
      radii,
      probeRadius: fieldProbe,
      resolution,
      maxBytes,
    }),
    [indices, radii, fieldProbe, resolution, maxBytes],
  );
  const gpu = useGpuSurface(
    coordinates,
    request,
    live && indices.length > 0 && fieldProbe >= 2 * resolution,
  );
  const onGpu = live && indices.length > 0 &&
    fieldProbe >= 2 * resolution && !gpu.unsupported;
  const snapshot = useCoordinateSnapshot({ enabled: !onGpu });
  const params = useMemo(
    () => ({ indices, probeRadius: fieldProbe, inflate, resolution, maxBytes }),
    [indices, fieldProbe, inflate, resolution, maxBytes],
  );
  const [cpuMesh, cpuFailure, cpuPending] = useGeometryJob(
    onGpu ? null : snapshot?.resource ?? null,
    params,
    buildSurfaceGeometry,
  );
  const gpuMesh = onGpu ? gpu.published : null;
  const failure = onGpu ? gpu.failure : cpuFailure;
  if (failure) return typeof error === "function" ? error(failure) : error;
  if (onGpu ? !gpuMesh : !snapshot || cpuPending) {
    return typeof loading === "function" ? loading() : loading;
  }
  const count = onGpu
    ? gpuMesh?.mesh?.vertexCount ?? 0
    : cpuMesh?.vertexCount ?? 0;
  if (!count) return null;

  const sourceAtom = plan.attrNames.length > 0 || !!plan.annotation;
  const specs: ColumnSpec[] = [];
  let gpuColumns: Record<string, StorageSource> = {};
  if (gpuMesh?.mesh) {
    const { mesh } = gpuMesh;
    const source = (
      buffer: GPUBuffer,
      format: "vec3<f32>" | "u32",
      length: number,
    ): StorageSource => ({
      buffer,
      format,
      length,
      size: [length],
      version: gpuMesh.generation,
    });
    gpuColumns = {
      positions: source(mesh.positions, "vec3<f32>", mesh.vertexCount),
      normals: source(mesh.normals, "vec3<f32>", mesh.vertexCount),
      indices: source(mesh.indices, "u32", mesh.triangleCount * 3),
      ...(sourceAtom
        ? { sourceAtom: source(mesh.sourceAtom, "u32", mesh.vertexCount) }
        : {}),
    };
  } else if (cpuMesh) {
    specs.push(
      { key: "positions", data: cpuMesh.positions, format: "vec3<f32>" },
      { key: "normals", data: cpuMesh.normals, format: "vec3<f32>" },
      { key: "indices", data: cpuMesh.indices, format: "u32" },
    );
    if (sourceAtom) {
      specs.push({
        key: "sourceAtom",
        data: cpuMesh.sourceAtom,
        format: "u32",
      });
    }
  }
  if (plan.annotation) specs.push(plan.annotation);
  const faces = (
    map: Record<string, StorageSource | null>,
    colors?: ShaderSource,
  ) =>
    use(CopyDraws, {
      positions: map.positions!,
      normals: map.normals!,
      render: (positions: ShaderSource, normals: ShaderSource | null) =>
        withMaterial(
          material,
          use(FaceLayer, {
            positions,
            normals: normals!,
            indices: map.indices!,
            color: drawColor,
            ...(colors ? { colors } : {}),
            shaded: true,
            side: "both",
            ...drawMode,
            ...props,
          }),
        ),
    });
  return withColumns(specs, (columns) => {
    const map = { ...columns, ...gpuColumns };
    return field
      ? use(FieldFaces, {
        field,
        positions: map.positions!,
        normals: map.normals!,
        sourceAtom: map.sourceAtom,
        annotation: map.annotation ?? null,
        data: resource.data,
        plan,
        sampleOffset,
        opacity,
        render: (colors: ShaderSource) => (faces(map, colors)),
      })
      : faces(map);
  });
};

/** Draw a solvent-excluded (or, with `kind="accessible"`, solvent-accessible)
 * molecular surface around the selected atoms.
 * Supported moving grids update GPU geometry; other cases use CPU snapshots.
 * Resolution and probeRadius control geometry; color and opacity style it. */
export const Surface: ViewerComponent<
  & {
    /** A molecular query or exact atom selection. Defaults to first-model/primary-altloc atoms. */
    select?: SelectionInput;
    /** "excluded" (default): the solvent-excluded surface a `probeRadius`
     * sphere rolls out. "accessible": the solvent-accessible surface, the
     * union of atoms grown by `probeRadius`, which closes channels the probe
     * fits through. */
    kind?: "excluded" | "accessible";
    /** Ångström probe radius; defaults to 1.4 (water). */
    probeRadius?: number;
    /** Grid spacing in Ångströms; defaults to 0.5. Smaller is finer and slower. */
    resolution?: number;
    /** Grid byte budget override; defaults to 256 MiB. */
    maxBytes?: number;
    /** A flat colour or an atom/position Field such as `byElement()` or `byPotential()`. */
    color?: VectorLike | Field;
    /** Å along the vertex normal where a colour field samples; default 1.4. */
    sampleOffset?: number;
    /** Wraps the shaded face layer; without one, the ambient scene material. */
    material?: MaterialSpec;
    loading?: ViewerElement | (() => ViewerElement);
    error?: ViewerElement | ((failure: unknown) => ViewerElement);
  }
  & Translucency
  & SelectionDiagnostics
> = withGeometryCopies((props) =>
  use(SelectionConsumer, {
    input: props.select,
    who: "Surface",
    onSelectionStatus: props.onSelectionStatus,
    warnEmptySelection: props.warnEmptySelection,
    render: (select: Selection) => {
      const { onSelectionStatus: _status, warnEmptySelection: _warn, ...draw } =
        props;
      return use(SurfaceResolved, {
        ...draw,
        select: props.select == null ? null : select,
      });
    },
  })
);
