import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "./types.ts";
import { use, useMemo, useRef } from "@use-gpu/live";
import { FaceLayer } from "@use-gpu/workbench";
import {
  attributeColumn,
  type SecondaryStructureTrace,
  secondaryStructureTrace,
  type Trace,
  traceTable,
  withAttributes,
  withSecondaryStructure,
} from "@molgpu/table";
import { useStructure } from "./structure-context.ts";
import { useCoordinateSnapshot } from "./coordinate-snapshot.ts";
import { useAttributeSnapshot } from "./attribute-snapshot.ts";
import {
  type ColumnSpec,
  useActiveRows,
  withColumns,
} from "./internal/representation.ts";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { withMaterial } from "./materials.ts";
import { buildRibbonGeometry } from "./internal/ribbon-geometry.ts";
import { ribbonDsspRows } from "./internal/ribbon-dssp.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { count } from "./internal/instrumentation.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

/**
 * Keep the previous SS trace while the trace is unchanged and its cartoon
 * projection (kinds and block flags) is equal: a new ssCode that only moves
 * T/S/- codes, or G/H within a helix, rebuilds no ribbon geometry.
 */
function useStableProjection(
  trace: Trace | null,
  ss: SecondaryStructureTrace | null,
): SecondaryStructureTrace | null {
  const previous = useRef<
    { trace: Trace | null; ss: SecondaryStructureTrace | null } | null
  >(null);
  const p = previous.current;
  const same = p && p.trace === trace && p.ss && ss &&
    p.ss.count === ss.count &&
    p.ss.kind.every((k, i) => k === ss.kind[i]);
  if (!same) previous.current = { trace, ss };
  return previous.current!.ss;
}

/**
 * Draw the polymer backbone as a flat, oriented ribbon: a CPU-extruded
 * cross-section (0sj.1's curve-segment kernel, oriented by 0sj.2's
 * per-residue direction/secondary-structure data) fed to FaceLayer as a
 * mesh. `select` (a @molgpu/select atom Selection) restricts which atoms
 * feed the trace, same as <Tube>; missing residues, chain/model breaks, and
 * a selection that drops a residue's guide atom all end a run rather than
 * bridging across it.
 *
 * Scope, deliberate: helix/sheet residues get a wide cross-section, coil a
 * narrow one, but there is no beta-strand arrowhead taper yet — a flat
 * ribbon throughout, not the full cartoon vocabulary. Only `select` and
 * `smooth` (samples per guide segment) rebuild the trace/spline geometry;
 * `color`/`opacity` update bindings.
 */
export const Ribbon: ViewerComponent<
  {
    /** A @molgpu/select atom Selection; without one, active model/primary-altloc atoms are used. */
    select?: Selection | null;
    /** Samples per guide segment; defaults to 8. */
    smooth?: number;
    color?: VectorLike;
    /** Wraps the shaded ribbon layer; without one, the ambient scene material. */
    material?: MaterialSpec;
    /**
     * `"model"` (default) draws the structure's `ssCode`. `"dssp"` runs DSSP
     * on each coordinate snapshot the ribbon draws, over the primary-altloc
     * atoms of every model the drawn atoms belong to, so codes always come
     * from the displayed coordinates of the displayed models.
     */
    secondaryStructure?: "model" | "dssp";
  } & Translucency
> = (
  {
    select,
    smooth = 8,
    secondaryStructure = "model",
    color = [0.85, 0.55, 0.35, 1],
    opacity = 1,
    mode,
    material,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("ribbon", color, opacity);
  checkOpacity(opacity, "Ribbon");
  const drawColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
  const drawMode = modeProps(mode, flatAlpha(color, false) * opacity);
  const { resource } = useStructure();
  const coordinateSnapshot = useCoordinateSnapshot();
  const snapshot = coordinateSnapshot?.data;
  const attributeSnapshot = useAttributeSnapshot("ssCode", {
    enabled: secondaryStructure === "model",
  });
  if (secondaryStructure !== "model" && secondaryStructure !== "dssp") {
    throw new TypeError("Ribbon secondaryStructure must be model or dssp");
  }
  const indices = useActiveRows(resource, select, "Ribbon");
  // DSSP covers the whole of each model the ribbon draws (efv.10), not only
  // the first model: a selection of model 2 gets model 2's codes.
  const dsspRows = useMemo(
    () =>
      secondaryStructure === "dssp"
        ? ribbonDsspRows(resource.data, indices)
        : null,
    [indices, secondaryStructure, resource.identity, resource.topologyRevision],
  );
  // DSSP rides on the snapshot object itself: its codes and the coordinates
  // the ribbon draws share one generation, and nothing replaces root data.
  const data = useMemo(
    () => {
      if (!snapshot) return null;
      if (dsspRows) {
        count("geometryBuilds", "ribbon:dssp");
        return withSecondaryStructure(snapshot, {
          mode: "dssp",
          rows: dsspRows,
        });
      }
      // GpuDssp holds its last completed code column briefly while a newer
      // coordinate generation runs, so generations may differ. The dataset
      // must still match: a snapshot from a replaced structure is ignored.
      if (attributeSnapshot?.data.identity === snapshot.identity) {
        const column = attributeColumn(attributeSnapshot.data, "ssCode");
        if (column?.provenance === "gpu:dssp") {
          return withAttributes(snapshot, { ssCode: column });
        }
      }
      return snapshot;
    },
    [snapshot, dsspRows, attributeSnapshot, coordinateSnapshot?.generation],
  );

  const trace = useMemo(
    () =>
      data
        ? (count("geometryBuilds", "ribbon:trace"), traceTable(data, indices))
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
  // Phase 10 keeps an unchanged column's object across attribute revisions.
  const ssColumn = data ? attributeColumn(data, "ssCode") : undefined;
  const ss = useStableProjection(
    trace,
    useMemo(
      () =>
        data && trace
          ? (count("geometryBuilds", "ribbon:ss"),
            secondaryStructureTrace(data, indices, trace))
          : null,
      [trace, ssColumn],
    ),
  );
  const built = useMemo(
    () => trace && ss ? buildRibbonGeometry(trace, ss, smooth) : null,
    [
      trace,
      ss,
      smooth,
    ],
  );
  if (!built?.vertexCount) return null;

  const specs: ColumnSpec[] = [
    { key: "positions", data: built.positions, format: "vec3<f32>" },
    { key: "normals", data: built.normals, format: "vec3<f32>" },
    { key: "indices", data: built.indices, format: "u32" },
  ];
  return withColumns(specs, (map) =>
    withMaterial(
      material,
      use(FaceLayer, {
        positions: map.positions,
        normals: map.normals,
        indices: map.indices,
        color: drawColor,
        shaded: true,
        side: "both",
        ...drawMode,
        ...props,
      }),
    ));
};
