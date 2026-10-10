import type { SelectionDiagnostics, SelectionInput } from "../types.ts";
import { SelectionConsumer } from "../selection/selection-consumer.ts";
import type { Selection } from "@molgpu/select";
import type { Field } from "@molgpu/fields";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "../types.ts";
import { use, useMemo } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";
import { LineLayer } from "@use-gpu/workbench";
import { traceTable } from "@molgpu/table";
import { useStructure } from "../structure/structure-context.ts";
import { useCoordinateSnapshot } from "../coordinates/coordinate-snapshot.ts";
import {
  type ColumnSpec,
  isField,
  useActiveRows,
  withColumns,
} from "../rendering/representation.ts";

import { useFieldPlan } from "../field-binding/use-field-plan.ts";
import {
  vertexAtoms,
  VertexFieldColors,
} from "../field-binding/vertex-field-colors.ts";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "../rendering/opacity.ts";
import { withMaterial } from "../rendering/with-material.ts";
import { CopyDraws, withGeometryCopies } from "../rendering/instance-copies.ts";
import { buildTubeGeometry } from "./tube-geometry.ts";
import { lineWidthForRadius } from "../rendering/line-size.ts";
import { useRepaint } from "../internal/use-repaint.ts";
import { count } from "../internal/instrumentation.ts";
import { useBindingProbe } from "../internal/use-binding-probe.ts";

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
const TubeResolved: ViewerComponent<
  {
    /** A molecular query or exact atom selection. Defaults to first-model/primary-altloc atoms. */
    select?: Selection | null;
    /** Ångström tube radius; defaults to 0.3. */
    radius?: number;
    /** Samples per guide segment; defaults to 6. */
    smooth?: number;
    /**
     * A flat colour or a numeric colour Field such as `byChain()`,
     * `bySecondaryStructure()` or a B-factor ramp. Each sample reads its
     * residue's guide atom (CA or nucleic trace atom); recolouring rebuilds
     * no geometry.
     */
    color?: VectorLike | Field;
    sides?: number;
    join?: "tangent" | "bevel" | "miter" | "round";
    /** Cast shadows under a shadow-enabled Pass; defaults to false. */
    shadow?: boolean;
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
  const field = isField(color) ? color : null;
  const drawColor = useMemo(
    () => field ? [1, 1, 1, 1] : applyOpacity(color as VectorLike, opacity),
    [field, color, opacity],
  );
  const drawMode = modeProps(mode, flatAlpha(color, !!field) * opacity);
  const { resource } = useStructure();
  const plan = useFieldPlan(field, resource, "Tube");
  const needsAtoms = plan.attrNames.length > 0 || plan.annotation !== null;
  const data = useCoordinateSnapshot()?.data;

  const indices = useActiveRows(resource, select, "Tube");
  const trace = useMemo(
    () =>
      data
        ? (count("geometryBuilds", "tube:trace"), traceTable(data, indices))
        : null,
    // Topology and coordinates only: an attribute change (charges, ssCode)
    // makes a new StructureData but no new trace.
    [
      data?.identity,
      data?.revision.topology,
      data?.revision.positions,
      indices,
    ],
  );
  const built = useMemo(() => trace ? buildTubeGeometry(trace, smooth) : null, [
    trace,
    smooth,
  ]);
  // Built once per geometry; a style change keeps the same column object.
  const sourceAtom = useMemo(
    () =>
      needsAtoms && trace && built?.count
        ? vertexAtoms(trace, built.residue)
        : null,
    [needsAtoms, trace, built],
  );
  if (!built?.count) return null;

  const width = lineWidthForRadius(radius, -1);
  const specs: ColumnSpec[] = [
    { key: "positions", data: built.positions, format: "vec3<f32>" },
    { key: "segments", data: built.segments, format: "i32" },
  ];
  if (sourceAtom) {
    specs.push({ key: "sourceAtom", data: sourceAtom, format: "u32" });
  }
  if (plan.annotation) specs.push(plan.annotation);
  const tube = (
    map: Record<string, StorageSource | null>,
    colors?: ShaderSource,
  ) =>
    use(CopyDraws, {
      positions: map.positions!,
      render: (positions: ShaderSource) =>
        withMaterial(
          material,
          use(LineLayer, {
            positions,
            // A copy's positions are a transformed getter with no length.
            count: built.count,
            segments: map.segments!,
            width,
            color: drawColor,
            ...(colors ? { colors } : {}),
            shaded: true,
            sides,
            join,
            depth: -1,
            ...drawMode,
            ...props,
          }),
        ),
    });
  return withColumns(specs, (map) =>
    field
      ? use(VertexFieldColors, {
        field,
        positions: map.positions!,
        sourceAtom: map.sourceAtom ?? null,
        annotation: map.annotation ?? null,
        data: resource.data,
        plan,
        opacity,
        render: (colors: ShaderSource) => (tube(map, colors)),
      })
      : tube(map));
};

/** Draw a polymer backbone tube from published coordinate snapshots.
 * A residue participates only when its guide atom is selected. Color fields
 * read guide-atom values; changing color or opacity preserves geometry. */
export const Tube: ViewerComponent<
  & {
    /** A molecular query or exact atom selection. Defaults to first-model/primary-altloc atoms. */
    select?: SelectionInput;
    /** Ångström tube radius; defaults to 0.3. */
    radius?: number;
    /** Samples per guide segment; defaults to 6. */
    smooth?: number;
    /**
     * A flat colour or a numeric colour Field such as `byChain()`,
     * `bySecondaryStructure()` or a B-factor ramp. Each sample reads its
     * residue's guide atom (CA or nucleic trace atom); recolouring rebuilds
     * no geometry.
     */
    color?: VectorLike | Field;
    sides?: number;
    join?: "tangent" | "bevel" | "miter" | "round";
    /** Cast shadows under a shadow-enabled Pass; defaults to false. */
    shadow?: boolean;
    /** Wraps the shaded tube layer; without one, the ambient scene material. */
    material?: MaterialSpec;
  }
  & Translucency
  & SelectionDiagnostics
> = withGeometryCopies((props) =>
  use(SelectionConsumer, {
    input: props.select,
    who: "Tube",
    onSelectionStatus: props.onSelectionStatus,
    warnEmptySelection: props.warnEmptySelection,
    render: (select: Selection) => {
      const { onSelectionStatus: _status, warnEmptySelection: _warn, ...draw } =
        props;
      return use(TubeResolved, {
        ...draw,
        select: props.select == null ? null : select,
      });
    },
  })
);
