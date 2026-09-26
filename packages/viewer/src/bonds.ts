import type { Field } from "@molgpu/fields";
import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  StructureResource,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "./types.ts";
import { type LC, type LiveElement, use, useMemo, useRef } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import { LineLayer } from "@use-gpu/workbench";
import { byElement } from "@molgpu/fields";
import { useStructure } from "./structure-context.ts";
import { useField } from "./use-field.ts";
import {
  type ColumnMap,
  type ColumnSpec,
  fieldAttrNames,
  isField,
  withColumns,
} from "./internal/representation.ts";

/** The last endpoint-attribute gather, reused while its inputs are unchanged. */
interface EndpointCache {
  readonly identity: StructureResource["identity"];
  readonly topologyRevision: number;
  readonly names: string;
  rows: Uint32Array;
  readonly columns: Record<string, Float32Array>;
}
/** LineLayer props Bonds forwards (draw mode and any upstream flags). */
type LineProps = Record<string, unknown>;
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { useOpacityColors } from "./internal/use-opacity-colors.ts";
import { withMaterial } from "./materials.ts";
import {
  buildBondColumns,
  endpointAttributes,
} from "./internal/bond-columns.ts";
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

// Endpoint attribute columns are a function of the topology columns, the
// endpoint rows and the column names. The rows are compared by content rather
// than by the geometry build: a coordinate edit rebuilds geometry but usually
// keeps the same rows. Inferred bonds can change with coordinates, and then the
// rows change too, so the columns are rebuilt.
const useEndpointAttributes = (
  resource: StructureResource,
  rows: Uint32Array,
  attrNames: readonly string[],
): Record<string, Float32Array> => {
  const cache = useRef<EndpointCache | null>(null);
  const names = attrNames.join();
  const hit = cache.current;
  if (
    hit && hit.identity === resource.identity &&
    hit.topologyRevision === resource.topologyRevision &&
    hit.names === names && sameRows(hit.rows, rows)
  ) {
    hit.rows = rows;
    return hit.columns;
  }
  const columns = endpointAttributes(resource.data, rows, attrNames);
  cache.current = {
    identity: resource.identity,
    topologyRevision: resource.topologyRevision,
    names,
    rows,
    columns,
  };
  return columns;
};

const line = (
  positions: ShaderSource | null,
  segments: ShaderSource | null,
  width: number,
  sides: number,
  shaded: boolean,
  extra: LineProps,
  props: LineProps,
): LiveElement =>
  use(LineLayer, {
    positions,
    segments,
    width,
    join: "round",
    ...(shaded ? { shaded: true, sides, depth: -1 } : {}),
    ...extra,
    ...props,
  });

// A colour field colours each endpoint by its atom, composed shader-side.
const FieldBonds: LC<
  {
    map: ColumnMap;
    field: Field;
    opacity: number;
    width: number;
    sides: number;
    shaded: boolean;
  } & LineProps
> = ({ map, field, opacity, width, sides, shaded, ...props }) => {
  const colors = useOpacityColors(
    useField(field, map as Record<string, ShaderSource>, { domain: "atom" }),
    opacity,
  );
  return line(
    map.positions,
    map.segments,
    width,
    sides,
    shaded,
    { colors },
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
  const { data } = resource;

  if (
    select !== undefined && select !== null &&
    (select.dataset !== resource.identity || select.domain !== "atom")
  ) {
    throw new TypeError("Bonds received a foreign or non-atom selection");
  }
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
  const built = useMemo(
    () => buildBondColumns(data, indices, endpoints, defaultColor),
    [data, selectKey, endpoints, defaultColor],
  );
  const attrs = useEndpointAttributes(resource, built.rows, attrNames);
  if (!built.n) return null;

  const specs: ColumnSpec[] = [
    { key: "positions", data: built.positions, format: "vec3<f32>" },
    { key: "segments", data: built.segments, format: "i32" },
    ...attrNames.map((name): ColumnSpec => ({
      key: `attr:${name}`,
      data: attrs[name],
      format: "f32",
    })),
  ];
  return withColumns(
    specs,
    (map) =>
      withMaterial(
        material,
        field
          ? use(FieldBonds, {
            map,
            field,
            opacity,
            width,
            sides,
            shaded,
            ...drawMode,
            ...props,
          })
          : line(map.positions, map.segments, width, sides, shaded, {
            color: flatColor,
            ...drawMode,
          }, props),
      ),
  );
};
