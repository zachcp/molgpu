import type { Field } from "@molgpu/fields";
import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "./types.ts";
import { type LC, type LiveElement, use, useMemo, useRef } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import type { StorageSource } from "@use-gpu/core";
import type { AttributeDomain } from "@molgpu/table";
import { LineLayer } from "@use-gpu/workbench";
import { byElement } from "@molgpu/fields";
import { useStructure, useStructureResource } from "./structure-context.ts";
import { useField } from "./use-field.ts";
import {
  checkAtomSelection,
  type ColumnMap,
  type ColumnSpec,
  fieldAttrNames,
  isField,
  withColumns,
} from "./internal/representation.ts";
import { useAttributeSources } from "./internal/attribute-sources.ts";
import { indexed } from "./internal/indexed.ts";
import { useCoordinates } from "./coordinates-context.ts";
import { useBondPositions } from "./internal/bond-positions.ts";

/** LineLayer props Bonds forwards (draw mode and any upstream flags). */
type LineProps = Record<string, unknown>;
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { useOpacityColors } from "./internal/use-opacity-colors.ts";
import { withMaterial } from "./internal/with-material.ts";
import { buildBondRows } from "./internal/bond-columns.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

// One stable default field; passing any explicit colour preserves the existing
// unsplit geometry and styling behavior.
const DEFAULT_COLOR = byElement();

const sameRows = (a: Uint32Array, b: Uint32Array): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// Keep the previous row array when a topology or selection update produces the
// same rows, so the field-colour index column does not upload again.
const useStableRows = (rows: Uint32Array): Uint32Array => {
  const previous = useRef<Uint32Array | null>(null);
  if (!previous.current || !sameRows(previous.current, rows)) {
    previous.current = rows;
  }
  return previous.current;
};

const line = (
  positions: ShaderSource | null,
  segments: ShaderSource | null,
  count: number,
  width: number,
  sides: number,
  shaded: boolean,
  extra: LineProps,
  props: LineProps,
): LiveElement =>
  use(LineLayer, {
    positions,
    segments,
    count,
    width,
    join: "round",
    ...(shaded ? { shaded: true, sides, depth: -1 } : {}),
    ...extra,
    ...props,
  });

// A colour field colours each endpoint by its atom, composed shader-side: the
// full attribute columns are read through each vertex's atom row.
const FieldBonds: LC<
  {
    map: ColumnMap;
    positions: ShaderSource;
    count: number;
    attrNames: readonly string[];
    attrSources: Record<string, StorageSource>;
    attrDomains: Record<string, AttributeDomain>;
    field: Field;
    opacity: number;
    width: number;
    sides: number;
    shaded: boolean;
  } & LineProps
> = (
  {
    map,
    positions,
    count,
    attrNames,
    attrSources,
    attrDomains,
    field,
    opacity,
    width,
    sides,
    shaded,
    ...props
  },
) => {
  const columns = attrNames.map((name) => attrSources[`attr:${name}`]);
  const domains = attrNames.map((name) => attrDomains[`attr:${name}`]);
  const attrs = useMemo(
    () =>
      Object.fromEntries(
        [
          ...attrNames.map((name, k) => [
            `attr:${name}`,
            attrDomains[`attr:${name}`] === "atom"
              ? indexed(columns[k]!, map.rows, "f32")
              : columns[k]!,
          ]),
          // A volume-sampled colour reads each vertex's own position.
          ["positions", positions],
        ],
      ),
    [map.rows, positions, attrNames.join(), ...domains, ...columns],
  );
  const colors = useOpacityColors(
    useField(field, attrs, { domain: "atom" }),
    opacity,
  );
  return line(
    positions,
    map.segments,
    count,
    width,
    sides,
    shaded,
    { colors },
    props,
  );
};

const BondLines: LC<{
  map: ColumnMap;
  coordinates: ShaderSource;
  count: number;
  split: boolean;
  field: Field | null;
  attrNames: readonly string[];
  attrSources: Record<string, StorageSource>;
  attrDomains: Record<string, AttributeDomain>;
  opacity: number;
  width: number;
  sides: number;
  shaded: boolean;
  color: VectorLike | Field;
}> = (
  {
    map,
    coordinates,
    count,
    split,
    field,
    attrNames,
    attrSources,
    attrDomains,
    opacity,
    width,
    sides,
    shaded,
    color,
    ...props
  },
) => {
  const positions = useBondPositions(map.endpoints!, coordinates, split);
  return field
    ? use(FieldBonds, {
      map,
      positions,
      count,
      attrNames,
      attrSources,
      attrDomains,
      field,
      opacity,
      width,
      sides,
      shaded,
      ...props,
    })
    : line(
      positions,
      map.segments,
      count,
      width,
      sides,
      shaded,
      { color },
      props,
    );
};

/**
 * Draw bonds as world-space sticks. `select` (a @molgpu/select atom Selection)
 * keeps bonds whose endpoints satisfy `endpoints` ('both', the default, or
 * 'either'); the endpoint policy is explicit and documented. By default, each
 * bond is split at its midpoint: the first half takes element A's colour and
 * the second takes element B's. An explicit `color` retains the unsplit stroke
 * and accepts a flat colour or a @molgpu/fields Field. Connectivity comes from
 * the shared bond topology (explicit, else inferred). `opacity` (0–1)
 * multiplies the colour's alpha as a uniform; below 1 the sticks draw in
 * transparent mode (pair with <Pass oit>) unless an explicit `mode` is given.
 */
export const Bonds: ViewerComponent<
  {
    /** Stick width; defaults to 0.3. */
    width?: number;
    /** A @molgpu/select atom Selection for this structure. */
    select?: Selection | null;
    /** Keep bonds whose endpoints are 'both' (default) or 'either' selected. */
    endpoints?: "both" | "either";
    /** A flat colour, or a @molgpu/fields Field coloured per endpoint atom. */
    color?: VectorLike | Field;
    sides?: number;
    shaded?: boolean;
    /** Wraps the shaded stick layer; without one, the ambient scene material. */
    material?: MaterialSpec;
  } & Translucency
> = (
  {
    width = 0.3,
    select,
    color,
    opacity = 1,
    mode,
    endpoints = "both",
    sides = 6,
    shaded = true,
    material,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("bonds", color, opacity, width);
  const { resource } = useStructure();
  // Bond inference belongs to root topology even beneath a live provider.
  const rootData = useStructureResource().data;
  const coordinates = useCoordinates();
  const { data } = resource;

  checkAtomSelection(select, resource, "Bonds");
  if (!["both", "either"].includes(endpoints)) {
    throw new TypeError("Bonds endpoints must be 'both' or 'either'");
  }
  const defaultColor = color === undefined;
  const effectiveColor = defaultColor ? DEFAULT_COLOR : color;
  const field = isField(effectiveColor) ? effectiveColor : null;
  const attrNames = useMemo(() => fieldAttrNames(field), [field]);
  checkOpacity(opacity, "Bonds");
  const flatColor = useMemo(
    () =>
      field
        ? effectiveColor
        : applyOpacity(effectiveColor as VectorLike, opacity),
    [field, effectiveColor, opacity],
  );
  const drawMode = modeProps(
    mode,
    flatAlpha(effectiveColor, !!field) * opacity,
  );
  const indices = select ? select.indices : null;
  const selectKey = select?.id ?? "all";
  // Explicit topology is independent of root positions. Inferred connectivity
  // may change when the root StructureData itself receives new positions.
  const inferenceRevision = data.topology.bonds.count
    ? 0
    : resource.positionsRevision;
  // Endpoint rows depend on topology/selection, never provider coordinates.
  const built = useMemo(
    () => buildBondRows(rootData, indices, endpoints, defaultColor),
    [
      resource.identity,
      resource.topologyRevision,
      inferenceRevision,
      selectKey,
      endpoints,
      defaultColor,
    ],
  );
  const rows = useStableRows(built.rows);
  const endpointRows = useStableRows(built.endpoints);
  // Full attribute columns follow topology only; selections, coordinate edits
  // and re-inferred bonds change only the row column.
  const attributes = useAttributeSources(data, attrNames);
  if (
    !coordinates || coordinates.ready === false || !attributes.ready || !built.n
  ) return null;

  const specs: ColumnSpec[] = [
    { key: "endpoints", data: endpointRows, format: "vec2<u32>" },
    { key: "segments", data: built.segments, format: "i32" },
  ];
  if (field) {
    specs.push({ key: "rows", data: rows, format: "u32" });
  }
  return withColumns(
    specs,
    (map) =>
      withMaterial(
        material,
        use(BondLines, {
          map,
          coordinates: coordinates.source,
          count: built.n,
          split: defaultColor,
          field,
          attrNames,
          attrSources: attributes.sources,
          attrDomains: attributes.domains,
          opacity,
          width,
          sides,
          shaded,
          color: flatColor as VectorLike | Field,
          ...drawMode,
          ...props,
        }),
      ),
  );
};
