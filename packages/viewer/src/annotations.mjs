import { use, useMemo } from '@use-gpu/live';
import { LabelLayer, LineLayer } from '@use-gpu/workbench';
import { useStructure } from './structure-context.mjs';
import { withColumns } from './internal/representation.mjs';
import { centroidOf, distanceBetween, midpoint } from './internal/centroid.mjs';
import { useRepaint } from './internal/use-repaint.mjs';
import { count } from './internal/instrumentation.mjs';
import { useBindingProbe } from './internal/use-binding-probe.mjs';

/** Guard a selection is this structure's atom domain (or null / a raw point). */
const checkSelection = (select, resource, who) => {
  if (select == null) return;
  if (select.dataset !== resource.identity || select.domain !== 'atom')
    throw new TypeError(`${who} received a foreign or non-atom selection`);
};

/** A selection's centroid, or an explicit [x,y,z] point passed through. */
const anchorOf = (data, select, label) => (count('geometryBuilds', label), centroidOf(data, select ? select.indices : null));

/**
 * LabelLayer binds a singular `position` as a vec4<f32> constant, so a bare
 * [x,y,z] arrives with w = 0 — a direction, projected to infinity — and the
 * glyphs silently land off-screen (hj0.6). Promote anchors to a homogeneous
 * point before handing them over.
 */
const toPoint = (p) => (p.length >= 4 ? p : [p[0], p[1], p[2], 1]);

/**
 * A flat text label anchored to the centroid of a selection (its mean atom
 * position), not a literal coordinate — so it tracks the group it names even as
 * the underlying atoms move. `select` (a @molgpu/select atom Selection) chooses
 * the atoms; without one the whole active structure's centroid is used. `at`
 * overrides with an explicit [x,y,z]. Text needs a font stack, so <FontLoader>
 * (the shaper) and <SDFFontProvider> (the glyph atlas) ancestors are required,
 * as for any @use-gpu label. Only `select`/`at` and the atoms' positions move
 * the anchor; `text`/`color`/`size` are style.
 */
export const Label = ({ select, at, text, size = 16, color = [1, 1, 1, 1], offset = [0, 0], family, ...props }) => {
  useRepaint();
  useBindingProbe('label', text, size, color);
  const { resource } = useStructure();
  const { data } = resource;
  checkSelection(select, resource, 'Label');
  const selectKey = select?.id ?? 'active';
  const computed = useMemo(() => anchorOf(data, select, 'label:anchor'), [data, selectKey, resource.positionsRevision]);
  const position = useMemo(() => toPoint(at ?? computed), [at, computed]);
  return use(LabelLayer, { position, label: text ?? '', size, color, offset, family, ...props });
};

/**
 * A distance measurement between the centroids of two selections: a line
 * connecting them and a label at the midpoint showing the separation. `a` and
 * `b` are @molgpu/select atom Selections of this structure; the distance is in
 * Ångström. `format` customises the label text (default `NN.NN Å`). Needs
 * <FontLoader> + <SDFFontProvider> ancestors for the label (as <Label> does).
 */
export const Distance = ({ a, b, color = [0.9, 0.9, 0.95, 1], width = 2, size = 14, labelColor, format, ...props }) => {
  useRepaint();
  useBindingProbe('distance', color, width, size, labelColor);
  const { resource } = useStructure();
  const { data } = resource;
  checkSelection(a, resource, 'Distance');
  checkSelection(b, resource, 'Distance');
  if (a == null || b == null) throw new TypeError('Distance requires two selections, a and b');

  const rev = resource.positionsRevision;
  const ca = useMemo(() => anchorOf(data, a, 'distance:anchor'), [data, a?.id, rev]);
  const cb = useMemo(() => anchorOf(data, b, 'distance:anchor'), [data, b?.id, rev]);
  const dist = distanceBetween(ca, cb);
  const mid = midpoint(ca, cb);
  const text = format ? format(dist) : `${dist.toFixed(2)} Å`;

  const specs = [
    { key: 'positions', data: Float32Array.of(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]), format: 'vec3<f32>' },
    { key: 'segments', data: Int32Array.of(1, 2), format: 'i32' }, // 1 = start, 2 = end: one open line.
  ];
  return withColumns(specs, (map) => [
    use(LineLayer, { positions: map.positions, segments: map.segments, width, color, join: 'round' }),
    use(LabelLayer, { position: toPoint(mid), label: text, size, color: labelColor ?? color, ...props }),
  ]);
};

/**
 * The centroid (mean atom position, in Ångström) of a selection of this
 * structure, or of the whole structure when `select` is null — the anchor
 * <Label>/<Distance> use, exposed for callers that need the point directly.
 */
export const centroid = (data, select = null) => centroidOf(data, select ? select.indices : null);
