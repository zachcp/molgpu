// S3: the lift. Everything Mol*-specific is confined to THIS FILE, which is the
// shape @molgpu/geo would take (INVARIANT 1 / INVARIANT 3): typed arrays in,
// typed arrays out, no Mol* types in the exported signature.
import { calcMolecularSurface } from 'molstar/lib/mol-math/geometry/molecular-surface.js';
import { getFastBoundary } from 'molstar/lib/mol-math/geometry/boundary.js';
import { OrderedSet } from 'molstar/lib/mol-data/int/ordered-set.js';

// calcMolecularSurface only ever touches ctx.shouldUpdate / ctx.update, so a
// stub stands in for mol-task's RuntimeContext (which is a TYPE-only import and
// is erased at runtime).
const STUB_CTX = { shouldUpdate: false, update: async () => {} };

/**
 * @param {{x,y,z,radius:Float32Array, count:number}} atoms
 * @param {{probeRadius?:number, resolution?:number, probePositions?:number}} opts
 * @returns {Promise<{values:Float32Array, dims:[number,number,number],
 *                    transform:Float32Array, resolution:number, maxRadius:number}>}
 *   `values` is the scalar distance field; `transform` maps grid space -> world.
 */
export async function molecularSurfaceField(atoms, opts = {}) {
  const { probeRadius = 1.4, resolution = 0.5, probePositions = 36 } = opts;

  const position = {
    x: atoms.x, y: atoms.y, z: atoms.z,
    radius: atoms.radius,
    id: atoms.id,
    indices: OrderedSet.ofBounds(0, atoms.count),
  };

  const boundary = getFastBoundary(position);
  let maxRadius = 0;
  for (let i = 0; i < atoms.count; i++) if (atoms.radius[i] > maxRadius) maxRadius = atoms.radius[i];

  const res = await calcMolecularSurface(
    STUB_CTX, position, boundary, maxRadius, null,
    { probeRadius, resolution, probePositions },
  );

  // Unwrap the Tensor into a plain typed array + dims, so nothing Mol*-shaped escapes.
  return {
    values: res.field.data,
    dims: res.field.space.dimensions,
    transform: Float32Array.from(res.transform),
    resolution: res.resolution,
    maxRadius: res.maxRadius,
    // isovalue for the solvent-excluded surface
    level: probeRadius,
  };
}
