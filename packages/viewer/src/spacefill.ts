import type { Field } from "@molgpu/fields";
import type { Selection } from "@molgpu/select";
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
import type { StructureData } from "@molgpu/table";
import type { AttributeDomain } from "@molgpu/table";
import { WorldSpacePointLayer } from "./world-space-points.ts";
import { type StructureSources, useStructure } from "./structure-context.ts";
import { useCoordinates } from "./coordinates-context.ts";
import { useField } from "./use-field.ts";
import { indexed } from "./internal/indexed.ts";
import { useAttributeSources } from "./internal/attribute-sources.ts";
import {
  checkAtomSelection,
  type ColumnMap,
  type ColumnSpec,
  fieldAttrNames,
  isField,
  withColumns,
} from "./internal/representation.ts";

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

// Reads the shared structure sources and full attribute columns through the
// selection's rows. Instance k draws atom indices[k], which is also the
// mapping Pickable registers.
const IndexedPoints: LC<
  {
    map: ColumnMap;
    attrNames: readonly string[];
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
    attrNames,
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
  const columns = attrNames.map((name) => attrSources[`attr:${name}`]);
  const domains = attrNames.map((name) => attrDomains[`attr:${name}`]);
  const sources = useMemo(() => ({
    positions: indexed(positions, index, "vec3<f32>"),
    radii: indexed(shared.radii, index, "f32"),
    attrs: Object.fromEntries(
      attrNames.map((name, k) => [
        `attr:${name}`,
        attrDomains[`attr:${name}`] === "atom"
          ? indexed(columns[k]!, index, "f32")
          : columns[k]!,
      ]),
    ),
  }), [shared, positions, index, attrNames.join(), ...domains, ...columns]);
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
// columns it reads. Attribute columns follow topology only, so neither a
// selection change nor a coordinate edit regathers them.
const SelectedSpacefill: LC<
  {
    data: StructureData;
    indices: Uint32Array | null;
    attrNames: readonly string[];
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
    attrNames,
    ...props
  },
) => {
  const attributes = useAttributeSources(data, attrNames);
  if (!attributes.ready) return null;
  const specs: ColumnSpec[] = [];
  if (indices) specs.push({ key: "index", data: indices, format: "u32" });
  const count = indices ? indices.length : data.topology.atoms.count;
  return withColumns(
    specs,
    (map) =>
      use(IndexedPoints, {
        map,
        attrNames,
        attrSources: attributes.sources,
        attrDomains: attributes.domains,
        count,
        ...props,
      }),
  );
};

/**
 * Render active atom sites as world-space shaded spheres. `select` (a
 * @molgpu/select atom Selection) restricts to a subset, drawn by reading the
 * shared structure columns through the selection's uploaded atom rows. `color` is either a flat colour or a @molgpu/fields Field,
 * which is composed shader-side over the atoms' columns (no per-atom colour
 * upload) via the viewer's useField. `material` (a @molgpu/viewer material
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
    /** A @molgpu/select atom Selection for this structure; restricts the draw. */
    select?: Selection | null;
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
> = (
  {
    scale = 1,
    select,
    color = [0.72, 0.72, 0.76, 1],
    opacity = 1,
    mode,
    material,
    pickable = false,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("spacefill", color, opacity, scale);
  const { resource, sources } = useStructure();
  const coordinates = useCoordinates();
  const { data } = resource;

  checkAtomSelection(select, resource, "Spacefill");
  const field = isField(color) ? color : null;
  // A colour field names the atom columns it reads; gather exactly those.
  const attrNames = useMemo(() => fieldAttrNames(field), [field]);
  checkOpacity(opacity, "Spacefill");
  const flatColor = useMemo(
    () => field ? color : applyOpacity(color as VectorLike, opacity),
    [field, color, opacity],
  );
  const drawMode = modeProps(mode, flatAlpha(color, !!field) * opacity);

  const indices = select ? select.indices : null;
  const n = indices ? indices.length : data.topology.atoms.count;
  if (!sources || !coordinates || coordinates.ready === false || n === 0) {
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
          attrNames,
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
