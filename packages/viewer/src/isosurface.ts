import { type VolumeLevel, volumeLevel } from "@molgpu/table";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
  ViewerElement,
} from "./types.ts";
import { use, useAwait, useMemo } from "@use-gpu/live";
import { FaceLayer } from "@use-gpu/workbench";
import { useVolume } from "./volume-context.ts";
import { type ColumnSpec, withColumns } from "./internal/representation.ts";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "./internal/opacity.ts";
import { withMaterial } from "./materials.ts";
import { runGeometryJob } from "./internal/geometry-job.ts";
import { buildIsosurface } from "./internal/isosurface-geometry.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

/**
 * An isosurface of the nearest `<Volume>`, extracted on the CPU with
 * @molgpu/geo's marching cubes and placed through the volume's full
 * index-to-world affine (sheared and rotated grids included). `level` is an
 * absolute isovalue, or `{ sigma: k }` for `mean + k * sigma` of the volume's
 * statistics; it defaults to `{ sigma: 1 }`. Only the volume and the resolved
 * level schedule a remesh (cancellable, latest wins); `color`, `opacity` and
 * `material` are layer bindings and never do. Samples below the level are
 * inside, so normals face decreasing values.
 */
export const Isosurface: ViewerComponent<
  {
    /** Absolute isovalue, or `{ sigma: k }`. Defaults to `{ sigma: 1 }`. */
    level?: VolumeLevel;
    color?: VectorLike;
    /** Wraps the shaded face layer; without one, the ambient scene material. */
    material?: MaterialSpec;
    loading?: ViewerElement | (() => ViewerElement);
    error?: ViewerElement | ((failure: unknown) => ViewerElement);
  } & Translucency
> = (
  {
    level = { sigma: 1 },
    color = [0.3, 0.55, 0.95, 1],
    opacity = 1,
    mode,
    material,
    loading = null,
    error = null,
    ...props
  },
) => {
  useRepaint();
  useBindingProbe("isosurface", color, opacity);
  checkOpacity(opacity, "Isosurface");
  const { volume } = useVolume();
  const iso = volumeLevel(volume, level);
  const drawColor = useMemo(() => applyOpacity(color, opacity), [
    color,
    opacity,
  ]);
  const drawMode = modeProps(mode, flatAlpha(color, false) * opacity);
  const [mesh, failure, pending] = useAwait(
    (cancelled: () => boolean) =>
      runGeometryJob(() => buildIsosurface(volume, iso), cancelled),
    [volume, iso],
  );

  if (pending) return typeof loading === "function" ? loading() : loading;
  if (failure) return typeof error === "function" ? error(failure) : error;
  if (!mesh) return null;

  const specs: ColumnSpec[] = [
    { key: "positions", data: mesh.positions, format: "vec3<f32>" },
    { key: "normals", data: mesh.normals, format: "vec3<f32>" },
    { key: "indices", data: mesh.indices, format: "u32" },
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
