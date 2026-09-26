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
import { LineLayer } from "@use-gpu/workbench";
import { byElement } from "@molgpu/fields";
import { useStructure } from "./structure-context.ts";
import { useField } from "./use-field.ts";
import {
  checkAtomSelection,
  type ColumnMap,
  type ColumnSpec,
  fieldAttrNames,
  isField,
  withColumns,
} from "./internal/representation.ts";
import { gatherAtomColumns } from "./internal/gather.ts";
import { indexed } from "./internal/indexed.ts";

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
import { buildBondColumns } from "./internal/bond-columns.ts";
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

// A coordinate edit rebuilds bond geometry but usually keeps the same endpoint
// rows. Keep the previous array when its contents match, so the uploaded row
// column is reused. Inferred bonds can change with coordinates; then the rows
// change and are uploaded again.
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

// A colour field colours each endpoint by its atom, composed shader-side: the
// full attribute columns are read through each vertex's atom row.
const FieldBonds: LC<
  {
    map: ColumnMap;
    attrNames: readonly string[];
    field: Field;
    opacity: number;
    width: number;
    sides: number;
    shaded: boolean;
  } & LineProps
> = ({ map, attrNames, field, opacity, width, sides, shaded, ...props }) => {
  const columns = attrNames.map((name) => map[`attr:${name}`]);
  const attrs = useMemo(
    () =>
      Object.fromEntries(
        attrNames.map((name, k) => [
          `attr:${name}`,
          indexed(columns[k]!, map.rows, "f32"),
        ]),
      ),
    [map.rows, attrNames.join(), ...columns],
  );
  const colors = useOpacityColors(
    useField(field, attrs, { domain: "atom" }),
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
  const built = useMemo(
    () => buildBondColumns(data, indices, endpoints, defaultColor),
    [data, selectKey, endpoints, defaultColor],
  );
  const rows = useStableRows(built.rows);
  // Full attribute columns follow topology only; selections, coordinate edits
  // and re-inferred bonds change only the row column.
  const attrs = useMemo(
    () => gatherAtomColumns(data, null, attrNames, "bonds"),
    [resource.identity, resource.topologyRevision, attrNames.join()],
  );
  if (!built.n) return null;

  const specs: ColumnSpec[] = [
    { key: "positions", data: built.positions, format: "vec3<f32>" },
    { key: "segments", data: built.segments, format: "i32" },
  ];
  if (field) {
    specs.push({ key: "rows", data: rows, format: "u32" });
    for (const name of attrNames) {
      specs.push({ key: `attr:${name}`, data: attrs[name], format: "f32" });
    }
  }
  return withColumns(
    specs,
    (map) =>
      withMaterial(
        material,
        field
          ? use(FieldBonds, {
            map,
            attrNames,
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
