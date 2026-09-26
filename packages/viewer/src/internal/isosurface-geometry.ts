// CPU isosurface of a VolumeData: @molgpu/geo marching cubes in index space,
// mapped through the volume's full affine. No Live or GPU dependency.
import { marchingCubes, type MarchingCubesMesh } from "@molgpu/geo";
import type { VolumeData } from "@molgpu/table";
import { count } from "./instrumentation.ts";

/** The mesh of `volume` at absolute isovalue `level`, or null when empty. */
export function buildIsosurface(
  volume: VolumeData,
  level: number,
): MarchingCubesMesh | null {
  if (volume.components !== 1) {
    throw new TypeError(
      "Isosurface expects a scalar volume; extract one with volumeComponent",
    );
  }
  if (volume.dims.some((n) => n < 2)) return null;
  count("geometryBuilds", "isosurface:mesh");
  const mesh = marchingCubes({
    values: volume.values,
    dims: volume.dims,
    level,
    transform: volume.transform,
  });
  return mesh.vertexCount ? mesh : null;
}
