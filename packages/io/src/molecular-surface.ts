import { createVolume } from "@molgpu/table";
import type {
  SurfaceField,
  SurfaceFieldAtoms,
  SurfaceFieldOptions,
} from "./types.ts";
import { errorFor, IoError } from "./error.ts";
import { gridToXFast } from "./grid.ts";

const surfaceError = errorFor("surface");

/**
 * Solvent-excluded-surface scalar field over a set of atoms, via Mol*'s
 * calcMolecularSurface — kept behind this runtime import boundary exactly
 * like parseBcif, so consumers of @molgpu/table/@molgpu/geo alone never
 * load it. `atoms` is plain owned columns (x/y/z/radius Float32Array[count]),
 * never a Mol* Structure/Unit. `values` is x-fastest
 * (values[i + nx * (j + ny * k)]), the layout @molgpu/geo's marchingCubes
 * reads, so the field feeds it directly.
 * `transform` is a column-major scale+translate Mat4 — read its diagonal as
 * `spacing` and its translation row as `origin` — and `level` is the isovalue
 * (the solvent-excluded-surface convention: the probe radius itself).
 */
export async function molecularSurfaceField(
  atoms: SurfaceFieldAtoms,
  options: SurfaceFieldOptions = {},
): Promise<SurfaceField> {
  const { probeRadius = 1.4, resolution = 0.5, probePositions = 36 } = options;
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
    // earlier version of this function, and the s3 spike, both did) starves
    // the internal neighbor search near convex/protruding regions, so the
    // "unvisited" (-1001 sentinel) region reaches much closer to the true
    // isosurface than expected — producing a sparse, fragmented mesh instead
    // of a closed surface, not a marching-cubes artifact.
    const boundary = getFastBoundary({ x, y, z, radius, id, indices });
    let maxRadius = 0;
    const searchRadius = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      if (radius[i] > maxRadius) maxRadius = radius[i];
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
    // The caller (e.g. the viewer's grid budget) has already bounded the grid,
    // so the VolumeData default ceiling does not apply here.
    const volume = createVolume({
      values,
      dims,
      transform: Float32Array.from(result.transform),
    }, { maxSamples: Infinity });
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
