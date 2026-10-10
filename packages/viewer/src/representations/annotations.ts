import { useSelectionInput } from "../selection/use-selection-input.ts";
import type { SelectionDiagnostics, SelectionInput } from "../types.ts";
import { SelectionConsumer } from "../selection/selection-consumer.ts";
import type { Selection } from "@molgpu/select";
import type { StructureData } from "@molgpu/table";
import type { VectorLike, ViewerComponent } from "../types.ts";
import { use, useContext, useMemo } from "@use-gpu/live";
import { LabelLayer, LineLayer } from "@use-gpu/workbench";
import { useStructure } from "../structure/structure-context.ts";
import { useCoordinateSnapshot } from "../coordinates/coordinate-snapshot.ts";
import { InstanceContext } from "../rendering/instance-context.ts";
import { copyRows } from "../rendering/instance-plan.ts";
import { withInstances } from "../rendering/instance-copies.ts";

import {
  checkAtomSelection,
  type ColumnSpec,
  useActiveRows,
  withColumns,
} from "../rendering/representation.ts";
import { applyOpacity, checkOpacity, modeProps } from "../rendering/opacity.ts";
import {
  centroidOf,
  distanceBetween,
  midpoint,
  type Point3,
} from "./centroid.ts";
import { useRepaint } from "../internal/use-repaint.ts";
import { count } from "../internal/instrumentation.ts";
import { useBindingProbe } from "../internal/use-binding-probe.ts";

/** The centroid of a label's rows (a selection's, else the default view). */
const anchorOf = (
  data: StructureData,
  rows: Uint32Array,
  label: string,
): Point3 => (count("geometryBuilds", label), centroidOf(data, rows));

/**
 * LabelLayer binds a singular `position` as a vec4<f32> constant, so a bare
 * [x,y,z] arrives with w = 0 — a direction, projected to infinity — and the
 * glyphs silently land off-screen. Promote anchors to a homogeneous
 * point before handing them over.
 */
const toPoint = (
  p: readonly number[],
): readonly number[] => (p.length >= 4 ? p : [p[0], p[1], p[2], 1]);

/**
 * A flat text label anchored to the centroid of a selection (its mean atom
 * position), not a literal coordinate — so it tracks the group it names even as
 * the underlying atoms move. `select` (a @molgpu/select atom Selection) chooses
 * the atoms; without one the whole active structure's centroid is used. `at`
 * overrides with an explicit [x,y,z]. Text needs a font stack, so <FontLoader>
 * (the shaper) and <SDFFontProvider> (the glyph atlas) ancestors are required,
 * as for any @use-gpu label. Only `select`/`at` and the atoms' positions move
 * the anchor; `text`/`color`/`size`/`opacity` are style. Text always blends
 * (SDF glyphs draw in transparent mode); `opacity` (0–1) scales its alpha.
 */
const LabelResolved: ViewerComponent<{
  select?: Selection | null;
  /** Explicit [x, y, z] anchor, overriding the selection centroid. */
  at?: readonly number[];
  text?: string;
  size?: number;
  color?: VectorLike;
  offset?: readonly number[];
  family?: string;
  /** 0–1, multiplied into the text colour's alpha (text always blends). */
  opacity?: number;
}> = (
  {
    select,
    at,
    text,
    size = 16,
    color = [1, 1, 1, 1],
    opacity = 1,
    offset = [0, 0],
    family,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("label", text, size, color, opacity);
  const { resource } = useStructure();
  const snapshot = useCoordinateSnapshot();
  const data = snapshot?.data;
  const rows = useActiveRows(resource, select, "Label");
  // Inside an assembly copy holding none of the rows, there is no label.
  const computed = useMemo(
    () => data && rows.length ? anchorOf(data, rows, "label:anchor") : null,
    [
      data,
      rows,
      snapshot?.generation,
    ],
  );
  const position = useMemo(
    () => at || computed ? toPoint(at ?? computed!) : null,
    [at, computed],
  );
  checkOpacity(opacity, "Label");
  const drawColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
  if (!position) return null;
  return use(LabelLayer, {
    position,
    label: text ?? "",
    size,
    color: drawColor,
    offset,
    family,
    ...props,
  });
};

const SEGMENTS = Int32Array.of(1, 2); // 1 = start, 2 = end: one open line.

/**
 * A distance measurement between the centroids of two selections: a line
 * connecting them and a label at the midpoint showing the separation. `a` and
 * `b` are @molgpu/select atom Selections of this structure; the distance is in
 * Ångström. `format` customises the label text (default `NN.NN Å`). Needs
 * <FontLoader> + <SDFFontProvider> ancestors for the label (as <Label> does).
 * `opacity` (0–1) fades line and label together; below 1 the line draws in
 * transparent mode.
 */
const DistanceResolved: ViewerComponent<{
  a: Selection;
  b: Selection;
  color?: VectorLike;
  width?: number;
  size?: number;
  labelColor?: VectorLike;
  /** 0–1, fades the line and label together. */
  opacity?: number;
  /** Customise the label text; receives the distance in Ångström. */
  format?: (distance: number) => string;
}> = (
  {
    a,
    b,
    color = [0.9, 0.9, 0.95, 1],
    opacity = 1,
    width = 2,
    size = 14,
    labelColor,
    format,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("distance", color, opacity, width, size, labelColor);
  const { resource } = useStructure();
  const snapshot = useCoordinateSnapshot();
  const data = snapshot?.data;
  checkAtomSelection(a, resource, "Distance");
  checkAtomSelection(b, resource, "Distance");
  if (a == null || b == null) {
    throw new TypeError("Distance requires two selections, a and b");
  }

  const rev = snapshot?.generation;
  // Inside an assembly copy, each end measures only that copy's atoms.
  const copy = useContext(InstanceContext);
  const aRows = useMemo(() => copyRows(a.indices, copy), [a?.id, copy]);
  const bRows = useMemo(() => copyRows(b.indices, copy), [b?.id, copy]);
  const ca = useMemo(
    () =>
      data && aRows.length ? anchorOf(data, aRows, "distance:anchor") : null,
    [
      data,
      aRows,
      rev,
    ],
  );
  const cb = useMemo(
    () =>
      data && bRows.length ? anchorOf(data, bRows, "distance:anchor") : null,
    [
      data,
      bRows,
      rev,
    ],
  );
  const dist = ca && cb ? distanceBetween(ca, cb) : null;
  const mid = ca && cb ? midpoint(ca, cb) : null;
  const text = dist == null
    ? ""
    : format
    ? format(dist)
    : `${dist.toFixed(2)} Å`;
  checkOpacity(opacity, "Distance");
  const lineColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
  const textColor = useMemo(() => applyOpacity(labelColor ?? color, opacity), [
    labelColor,
    color,
    opacity,
  ]);
  const lineMode = modeProps(
    undefined,
    (color.length > 3 ? color[3] : 1) * opacity,
  );

  // Built once per anchor pair, so style edits reuse the uploaded columns.
  const specs = useMemo((): ColumnSpec[] | null =>
    ca && cb
      ? [
        {
          key: "positions",
          data: Float32Array.of(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]),
          format: "vec3<f32>",
        },
        { key: "segments", data: SEGMENTS, format: "i32" },
      ]
      : null, [ca, cb]);
  if (!specs || !mid) return null;
  return withColumns(specs, (map) => [
    use(LineLayer, {
      positions: map.positions,
      segments: map.segments,
      width,
      color: lineColor,
      join: "round",
      ...lineMode,
    }),
    use(LabelLayer, {
      position: toPoint(mid),
      label: text,
      size,
      color: textColor,
      ...props,
    }),
  ]);
};

/** Text anchored to selected atom centroids, using published coordinates.
 * Requires FontLoader and SDFFontProvider ancestors; at overrides the anchor. */
export const Label: ViewerComponent<
  {
    select?: SelectionInput;
    /** Explicit [x, y, z] anchor, overriding the selection centroid. */
    at?: readonly number[];
    text?: string;
    size?: number;
    color?: VectorLike;
    offset?: readonly number[];
    family?: string;
    /** 0–1, multiplied into the text colour's alpha (text always blends). */
    opacity?: number;
  } & SelectionDiagnostics
> = (props) => (use(props.at ? LabelOnce : LabelCopies, props));

/** One label per call: the selection centroid or an explicit `at`. */
const LabelOnce: typeof Label = (props) =>
  use(SelectionConsumer, {
    input: props.select,
    who: "Label",
    onSelectionStatus: props.onSelectionStatus,
    warnEmptySelection: props.warnEmptySelection,
    render: (select: Selection) => {
      const { onSelectionStatus: _status, warnEmptySelection: _warn, ...draw } =
        props;
      return use(LabelResolved, {
        ...draw,
        select: props.select == null ? null : select,
      });
    },
  });

/**
 * One label per drawn biological assembly copy of the nearest structure, each
 * anchored with that copy's coordinates (an explicit `at` draws once).
 */
const LabelCopies = withInstances(LabelOnce);

/** Line and distance label between two selection centroids, in angstroms.
 * Anchors follow published coordinate snapshots; font providers are required. */
export const Distance: ViewerComponent<
  {
    a: SelectionInput;
    b: SelectionInput;
    color?: VectorLike;
    width?: number;
    size?: number;
    labelColor?: VectorLike;
    /** 0–1, fades the line and label together. */
    opacity?: number;
    /** Customise the label text; receives the distance in Ångström. */
    format?: (distance: number) => string;
  } & SelectionDiagnostics
> = withInstances((props) => {
  const a = useSelectionInput(props.a, "Distance", "a", props);
  const b = useSelectionInput(props.b, "Distance", "b", props);
  if (
    a.status !== "ready" || b.status !== "ready" ||
    !a.selection.indices.length || !b.selection.indices.length
  ) return null;
  const { onSelectionStatus: _status, warnEmptySelection: _warn, ...draw } =
    props;
  return use(DistanceResolved, { ...draw, a: a.selection, b: b.selection });
});
