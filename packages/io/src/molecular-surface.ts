import { createVolume, MAX_VOLUME_SAMPLES } from "@molgpu/table";
import type {
  SurfaceField,
  SurfaceFieldAtoms,
  SurfaceFieldOptions,
} from "./types.ts";
import { errorFor, IoError } from "./error.ts";
import { gridToXFast } from "./grid.ts";

const surfaceError = errorFor("surface");

/**
 * Compute a solvent-excluded surface grid from finite atom coordinates and
 * positive van der Waals radii, in Ångström. Mol* loads on demand.
 *
 * Returns owned arrays with x-fastest values (`i + nx * (j + ny * k)`).
 * `transform` maps grid indices to Ångström using a column-major 4×4 matrix;
 * spacing is at entries 0, 5 and 10, and origin at 12, 13 and 14. `level`
 * equals the probe radius. Pass the result directly to `@molgpu/geo`'s
 * `marchingCubes`. `maxSamples` limits grid samples, not total memory use.
 */
export async function molecularSurfaceField(
  atoms: SurfaceFieldAtoms,
  options: SurfaceFieldOptions = {},
): Promise<SurfaceField> {
  const {
    probeRadius = 1.4,
    resolution = 0.5,
    probePositions = 36,
    maxSamples = MAX_VOLUME_SAMPLES,
  } = options;
  const { x, y, z, radius, count } = atoms;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw surfaceError(
      "atoms.count must be a nonnegative safe integer",
      "INVALID_INPUT",
    );
  }
  if (
    ![x, y, z, radius].every((a) =>
      a instanceof Float32Array && a.length === count
    )
  ) {
    throw surfaceError(
      "atoms.x/y/z/radius must each be a Float32Array[count]",
      "INVALID_INPUT",
    );
  }
  if (count === 0) {
    throw surfaceError(
      "atoms must contain at least one atom",
      "EMPTY_INPUT",
    );
  }
  if (
    !Number.isFinite(probeRadius) || probeRadius < 0 || probeRadius > 10 ||
    !Number.isFinite(resolution) || resolution < 0.01 || resolution > 20 ||
    !Number.isSafeInteger(probePositions) || probePositions < 12 ||
    probePositions > 90 ||
    !Number.isSafeInteger(maxSamples) || maxSamples < 1
  ) {
    throw surfaceError(
      "surface options require probeRadius in [0,10], resolution in [0.01,20], integer probePositions in [12,90], and positive safe-integer maxSamples",
      "INVALID_INPUT",
    );
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let maxRadius = 0;
  for (let i = 0; i < count; i++) {
    if (
      !Number.isFinite(radius[i]) || radius[i] <= 0 ||
      !Number.isFinite(Math.fround(radius[i] + probeRadius))
    ) {
      throw surfaceError(
        "atom radii must be finite and positive",
        "INVALID_INPUT",
      );
    }
    maxRadius = Math.max(maxRadius, radius[i]);
    for (const [axis, column] of [x, y, z].entries()) {
      const value = column[i];
      if (!Number.isFinite(value)) {
        throw surfaceError("atom coordinates must be finite", "INVALID_INPUT");
      }
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  // Mirror Mol* 5.12.0: getFastBoundary ignores radii; molecular-surface
  // expands that box by maxRadius + resolution, scales each endpoint, then
  // subtracts and ceils. Keep its operation order at floating-point boundaries.
  const pad = maxRadius + resolution;
  const scale = 1 / resolution;
  const dims = min.map((value, axis) =>
    Math.ceil((max[axis] + pad) * scale - (value - pad) * scale)
  );
  const samples = dims[0] * dims[1] * dims[2];
  if (
    !dims.every((n) => Number.isSafeInteger(n) && n >= 2) ||
    !Number.isSafeInteger(samples) || samples > maxSamples
  ) {
    throw surfaceError(
      `surface grid ${dims.join("×")} exceeds maxSamples ${maxSamples}`,
      "VOLUME_TOO_LARGE",
    );
  }
  try {
    const [{ calcMolecularSurface }, { getFastBoundary }, { OrderedSet }] =
      await Promise.all([
        import("molstar/lib/mol-math/geometry/molecular-surface.js"),
        import("molstar/lib/mol-math/geometry/boundary.js"),
        import("molstar/lib/mol-data/int/ordered-set.js"),
      ]);
    const id = Uint32Array.from({ length: count }, (_, i) => i);
    const indices = OrderedSet.ofBounds(0, count);
    // The boundary is computed from the plain van der Waals radii; maxRadius
    // is their max, unmodified. calcMolecularSurface itself, though, expects
    // each atom's SEARCH radius to already include the probe — Mol*'s own
    // callers (mol-repr/.../util/molecular-surface.js) build exactly this
    // `r + probeRadius` array before calling it. Skipping that (as an
    // earlier version of this function did) starves
    // the internal neighbor search near convex/protruding regions, so the
    // "unvisited" (-1001 sentinel) region reaches much closer to the true
    // isosurface than expected — producing a sparse, fragmented mesh instead
    // of a closed surface, not a marching-cubes artifact.
    const boundary = getFastBoundary({ x, y, z, radius, id, indices });
    const searchRadius = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      searchRadius[i] = radius[i] + probeRadius;
    }
    const position = { x, y, z, id, indices, radius: searchRadius };
    // calcMolecularSurface only ever touches ctx.shouldUpdate/ctx.update; a
    // stub stands in for mol-task's RuntimeContext (a type-only import, erased at runtime).
    const stubContext = { shouldUpdate: false, update: async () => {} };
    const result = await calcMolecularSurface(
      stubContext as unknown as Parameters<typeof calcMolecularSurface>[0],
      position,
      boundary,
      maxRadius,
      null,
      { probeRadius, resolution, probePositions },
    );
    // Mol*'s tensor stores the grid in its own axis order (z fastest). Lower
    // it to the x-fastest layout @molgpu/geo's marchingCubes reads, reading
    // through space.get so this stays correct whatever Mol*'s order is.
    const { space, data } = result.field;
    const { dims, values } = gridToXFast(space, data);
    const volume = createVolume({
      values,
      dims,
      transform: Float32Array.from(result.transform),
    }, { maxSamples });
    return Object.freeze({
      ...volume,
      resolution: result.resolution,
      maxRadius: result.maxRadius,
      level: probeRadius,
    });
  } catch (error) {
    if (error instanceof IoError) throw error;
    throw surfaceError(
      "Unable to compute the molecular surface field",
      "FIELD_UNAVAILABLE",
      error,
    );
  }
}
