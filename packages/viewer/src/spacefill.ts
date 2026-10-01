import type { SelectionDiagnostics, SelectionInput } from "./types.ts";
import { useSelectionInput } from "./internal/use-selection-input.ts";
import type { Field } from "@molgpu/fields";
import type {
  MaterialSpec,
  PointLayerOptions,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "./types.ts";
import { type LC, use, useMemo } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import type { StorageSource } from "@use-gpu/core";
import type { AttributeDomain, StructureData } from "@molgpu/table";
import { WorldSpacePointLayer } from "./world-space-points.ts";
import { type StructureSources, useStructure } from "./structure-context.ts";
import { useCoordinates } from "./coordinates-context.ts";
import { useField } from "./use-field.ts";
import { indexed } from "./internal/indexed.ts";
import { useAttributeSources } from "./internal/attribute-sources.ts";
import {
  type ColumnMap,
  type ColumnSpec,
  isField,
  useActiveRows,
  withColumns,
} from "./internal/representation.ts";
import { allOrRows } from "./internal/view-rows.ts";
import {
  fieldColumns,
  type FieldPlan,
  useFieldPlan,
} from "./internal/use-field-plan.ts";

/** Point-layer props Spacefill forwards to its layer (flags, draw mode, picking id). */
type LayerProps = PointLayerOptions & {
  mode?: "opaque" | "transparent";
  id?: number;
};
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { useOpacityColors } from "./internal/use-opacity-colors.ts";
import { withMaterial } from "./internal/with-material.ts";
import { Pickable } from "./picking.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

// A field always colours here, so useField is called unconditionally.
const FieldPoints: LC<
  {
    positions: ShaderSource;
    attrs: Record<string, ShaderSource>;
    radii: ShaderSource;
    count: number;
    field: Field;
    opacity: number;
    scale: number;
  } & LayerProps
> = ({ positions, attrs, radii, count, field, opacity, scale, ...props }) => {
  const inputs = useMemo(() => ({ ...attrs, positions }), [attrs, positions]);
  const colors = useOpacityColors(
    useField(field, inputs, { domain: "atom" }),
    opacity,
  );
  return use(WorldSpacePointLayer, {
    positions,
    colors,
    radii,
    count,
    scale,
    shape: "circle",
    shaded: true,
    ...props,
  });
};

// Reads the shared structure sources, full attribute columns and the field's
// annotation rows through the selection's rows. Instance k draws atom
// indices[k], which is also the mapping Pickable registers.
const IndexedPoints: LC<
  {
    map: ColumnMap;
    plan: FieldPlan;
    attrSources: Record<string, StorageSource>;
    attrDomains: Record<string, AttributeDomain>;
    shared: StructureSources;
    positions: ShaderSource;
    count: number;
    field: Field | null;
    opacity: number;
    color: unknown;
    scale: number;
  } & LayerProps
> = (
  {
    map,
    plan,
    attrSources,
    attrDomains,
    shared,
    positions,
    count,
    field,
    opacity,
    color,
    scale,
    ...props
  },
) => {
  const index = map.index ?? null;
  const keys = plan.attrNames.map((name) => `attr:${name}`);
  const sources = useMemo(() => ({
    positions: indexed(positions, index, "vec3<f32>"),
    radii: indexed(shared.radii, index, "f32"),
    attrs: fieldColumns(plan, attrSources, attrDomains, map.annotation, index),
  }), [
    shared,
    positions,
    index,
    plan,
    map.annotation,
    ...keys.map((key) => attrSources[key]),
    ...keys.map((key) => attrDomains[key]),
  ]);
  return field
    ? use(FieldPoints, {
      positions: sources.positions,
      attrs: sources.attrs,
      radii: sources.radii,
      count,
      field,
      opacity,
      scale,
      ...props,
    })
    : use(WorldSpacePointLayer, {
      positions: sources.positions,
      radii: sources.radii,
      count,
      scale,
      color,
      shape: "circle",
      shaded: true,
      ...props,
    });
};

// Uploads a selection's rows and, for a colour field, the full attribute
// columns and annotation rows it reads. Those follow topology and the field
// only, so neither a selection change nor a coordinate edit regathers them.
const SelectedSpacefill: LC<
  {
    data: StructureData;
    indices: Uint32Array | null;
    plan: FieldPlan;
    field: Field | null;
    opacity: number;
    shared: StructureSources;
    positions: ShaderSource;
    color: unknown;
    scale: number;
  } & LayerProps
> = (
  {
    data,
    indices,
    plan,
    ...props
  },
) => {
  const attributes = useAttributeSources(data, plan.attrNames);
  if (!attributes.ready) return null;
  const specs: ColumnSpec[] = [];
  if (indices) specs.push({ key: "index", data: indices, format: "u32" });
  if (plan.annotation) specs.push(plan.annotation);
  const count = indices ? indices.length : data.topology.atoms.count;
  return withColumns(
    specs,
    (map) =>
      use(IndexedPoints, {
        map,
        plan,
        attrSources: attributes.sources,
        attrDomains: attributes.domains,
        count,
        ...props,
      }),
  );
};

/**
 * Render atom sites as world-space shaded spheres: the first model's
 * primary-conformer atoms, or exactly `select` (a @molgpu/select atom
 * Selection, which may reach other models or conformers), drawn by reading
 * the shared structure columns through the uploaded atom rows. `color` is either a flat colour or a @molgpu/fields Field,
 * which is composed shader-side over the atoms' columns (no per-atom colour
 * upload; an annotation uploads its own rows once) via the viewer's useField,
 * including a `volumeSample()` of the nearest volume. `material` (a @molgpu/viewer material
 * spec) wraps the shaded point layer; without one the atoms use the ambient
 * scene material. `opacity` (0–1) multiplies the colour's alpha — a uniform,
 * so fading never touches geometry — and below 1 the atoms draw in transparent
 * mode (pair with <Pass oit>); an explicit `mode` overrides. `pickable` draws the atoms into the picking buffer so
 * usePicking() can resolve the cursor to an atom row (needs a <PickingProvider>
 * and a <Pass picking>).
 */
export const Spacefill: ViewerComponent<
  & {
    /** Multiplies each atom's Ångström radius; defaults to 1. */
    scale?: number;
    /** A molecular query or exact atom selection for this structure; restricts the draw. */
    select?: SelectionInput;
    /** A flat colour, or a @molgpu/fields Field composed shader-side per atom. */
    color?: VectorLike | Field;
    /** Wraps the shaded point layer; without one, the ambient scene material. */
    material?: MaterialSpec;
    /** Draw the atoms into the picking buffer so usePicking() can resolve them
     *  (needs a <PickingProvider> and a <Pass picking>). Defaults to false. */
    pickable?: boolean;
  }
  & Translucency
  & PointLayerOptions
  & SelectionDiagnostics
> = (
  {
    scale = 1,
    select: input,
    onSelectionStatus,
    warnEmptySelection,
    color = [0.72, 0.72, 0.76, 1],
    opacity = 1,
    mode,
    material,
    pickable = false,
    ...props
  },
) => {
  const result = useSelectionInput(input, "Spacefill", "select", {
    onSelectionStatus,
    warnEmptySelection,
  });
  const select = input == null
    ? null
    : result.status === "ready"
    ? result.selection
    : null;
  useRepaint();
  useBindingProbe("spacefill", color, opacity, scale);
  const { resource, sources } = useStructure();
  const coordinates = useCoordinates();
  const { data } = resource;

  const rows = useActiveRows(resource, select, "Spacefill");
  // Every row in order draws straight from the shared sources, unindexed.
  const indices = useMemo(() => allOrRows(data, rows), [rows]);
  const field = isField(color) ? color : null;
  // A colour field names the columns it reads; gather exactly those.
  const plan = useFieldPlan(field, resource, "Spacefill");
  checkOpacity(opacity, "Spacefill");
  const flatColor = useMemo(
    () => field ? color : applyOpacity(color as VectorLike, opacity),
    [field, color, opacity],
  );
  const drawMode = modeProps(mode, flatAlpha(color, !!field) * opacity);

  const n = indices ? indices.length : data.topology.atoms.count;
  if (
    result.status !== "ready" || !result.selection.indices.length || !sources ||
    !coordinates || coordinates.ready === false || n === 0
  ) {
    return null;
  }

  // Build the shaded layer, given the picking id to draw under (undefined when
  // not pickable → PointLayer emits no picking id). The whole-structure flat
  // path keeps the shared, already-uploaded source; both paths forward `id`.
  const draw = (id: number | undefined) =>
    withMaterial(
      material,
      (!indices && !field)
        ? use(WorldSpacePointLayer, {
          positions: coordinates.source,
          radii: sources.radii,
          count: n,
          scale,
          color: flatColor,
          shape: "circle",
          shaded: true,
          id,
          ...drawMode,
          ...props,
        })
        : use(SelectedSpacefill, {
          data,
          indices,
          plan,
          field,
          opacity,
          shared: sources,
          positions: coordinates.source,
          color: flatColor,
          scale,
          id,
          ...drawMode,
          ...props,
        }),
    );

  // Instance k draws atom indices[k] for a selection, otherwise atom row k.
  return pickable
    ? use(Pickable, { resource, indices, render: draw })
    : draw(undefined);
};
