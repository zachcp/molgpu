import type { Selection } from "@molgpu/select";
import type { StructureData } from "@molgpu/table";
import type {
  StructureResource,
  VectorLike,
  ViewerComponent,
} from "./types.ts";
import { use, useMemo } from "@use-gpu/live";
import { LabelLayer, LineLayer } from "@use-gpu/workbench";
import { useStructure } from "./structure-context.ts";
import { type ColumnSpec, withColumns } from "./internal/representation.ts";
import { applyOpacity, checkOpacity, modeProps } from "./internal/opacity.ts";
import {
  centroidOf,
  distanceBetween,
  midpoint,
  type Point3,
} from "./internal/centroid.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { count } from "./internal/instrumentation.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

/** Guard a selection is this structure's atom domain (or null / a raw point). */
const checkSelection = (
  select: Selection | null | undefined,
  resource: StructureResource,
  who: string,
): void => {
  if (select == null) return;
  if (select.dataset !== resource.identity || select.domain !== "atom") {
    throw new TypeError(`${who} received a foreign or non-atom selection`);
  }
};

/** A selection's centroid, or an explicit [x,y,z] point passed through. */
const anchorOf = (
  data: StructureData,
  select: Selection | null | undefined,
  label: string,
): Point3 => (count("geometryBuilds", label),
  centroidOf(data, select ? select.indices : null));

/**
 * LabelLayer binds a singular `position` as a vec4<f32> constant, so a bare
 * [x,y,z] arrives with w = 0 — a direction, projected to infinity — and the
 * glyphs silently land off-screen (hj0.6). Promote anchors to a homogeneous
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
export const Label: ViewerComponent<{
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
  const { data } = resource;
  checkSelection(select, resource, "Label");
  const selectKey = select?.id ?? "active";
  const computed = useMemo(() => anchorOf(data, select, "label:anchor"), [
    data,
    selectKey,
    resource.positionsRevision,
  ]);
  const position = useMemo(() => toPoint(at ?? computed), [at, computed]);
  checkOpacity(opacity, "Label");
  const drawColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
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
export const Distance: ViewerComponent<{
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
  const { data } = resource;
  checkSelection(a, resource, "Distance");
  checkSelection(b, resource, "Distance");
  if (a == null || b == null) {
    throw new TypeError("Distance requires two selections, a and b");
  }

  const rev = resource.positionsRevision;
  const ca = useMemo(() => anchorOf(data, a, "distance:anchor"), [
    data,
    a?.id,
    rev,
  ]);
  const cb = useMemo(() => anchorOf(data, b, "distance:anchor"), [
    data,
    b?.id,
    rev,
  ]);
  const dist = distanceBetween(ca, cb);
  const mid = midpoint(ca, cb);
  const text = format ? format(dist) : `${dist.toFixed(2)} Å`;
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
  const specs = useMemo((): ColumnSpec[] => [
    {
      key: "positions",
      data: Float32Array.of(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]),
      format: "vec3<f32>",
    },
    { key: "segments", data: SEGMENTS, format: "i32" },
  ], [ca, cb]);
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

/**
 * The centroid (mean atom position, in Ångström) of a selection of this
 * structure, or of the whole structure when `select` is null — the anchor
 * <Label>/<Distance> use, exposed for callers that need the point directly.
 */
export function centroid(
  data: StructureData,
  select: Selection | null = null,
): [number, number, number] {
  return centroidOf(data, select ? select.indices : null);
}
