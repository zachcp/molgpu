// Pure(ish) build step for <Surface>: gather selected atoms, preflight the
// grid budget, compute the scalar field (the sole @molgpu/io Mol* runtime
// boundary this package reaches through), extract the isosurface
// (@molgpu/geo's marching-cubes port), and attribute each vertex to its
// nearest source atom (@molgpu/geo). Not itself pure — it awaits an async
// io call — but has no Live/GPU dependency, so it is the kernel a
// useGeometryJob (0sj.7) call wraps.
import { marchingCubes, nearestAtomAttribution } from '@molgpu/geo';
import { assertGridBudget } from './geometry-job.mjs';
import { count } from './instrumentation.mjs';

function gatherAtoms(data, indices) {
  count('gathers', 'surface:atoms');
  const n = indices.length;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), radius = new Float32Array(n);
  let maxRadius = 0;
  const R = data.topology.atoms.radius;
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    x[k] = data.positions[i * 3]; y[k] = data.positions[i * 3 + 1]; z[k] = data.positions[i * 3 + 2];
    radius[k] = R[i];
    if (R[i] > maxRadius) maxRadius = R[i];
  }
  return { x, y, z, radius, count: n, maxRadius };
}

/**
 * Predict calcMolecularSurface's own grid dims (pad = maxRadius +
 * resolution around the atom bounding box, cells = ceil(extent /
 * resolution)) so an oversize request is refused before the actual field
 * is computed, not after it has already been allocated.
 */
function predictGridDims({ x, y, z, maxRadius, count }, resolution) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < count; k++) {
    min[0] = Math.min(min[0], x[k]); max[0] = Math.max(max[0], x[k]);
    min[1] = Math.min(min[1], y[k]); max[1] = Math.max(max[1], y[k]);
    min[2] = Math.min(min[2], z[k]); max[2] = Math.max(max[2], z[k]);
  }
  const pad = maxRadius + resolution;
  return [0, 1, 2].map(c => Math.max(2, Math.ceil((max[c] - min[c] + 2 * pad) / resolution)));
}

/**
 * `resource`/`params` match useGeometryJob's kernel(resource, params)
 * contract. `params.indices` is the atom selection; `params.probeRadius`/
 * `params.resolution` are the geometry-only parameters (see geometryDeps —
 * color/opacity must never reach here). Returns null when the selection is
 * empty or produced no isosurface (e.g. atoms too sparse for the isolevel).
 */
export async function buildSurfaceGeometry(resource, { indices, probeRadius = 1.4, resolution = 0.5, maxBytes } = {}) {
  const { data } = resource;
  if (!indices.length) return null;
  count('geometryBuilds', 'surface:mesh');
  const atoms = gatherAtoms(data, indices);
  assertGridBudget(predictGridDims(atoms, resolution), maxBytes !== undefined ? { maxBytes } : {});

  const { molecularSurfaceField } = await import('@molgpu/io');
  const field = await molecularSurfaceField(atoms, { probeRadius, resolution });
  // No sentinel clamp here: Mol*'s own molecular-surface-mesh.js visual feeds
  // its field straight into marching cubes with no such step, and matches —
  // the -1001 fill value only matters for dual-contouring's gradient-based
  // normal estimate (see docs/findings/2026-09-15-s3-molecular-surface.md),
  // not for marching cubes, which only interpolates across a real crossing.
  const m = field.transform;
  const mesh = marchingCubes({
    values: field.values, dims: field.dims, level: field.level,
    origin: [m[12], m[13], m[14]], spacing: [m[0], m[5], m[10]],
  });
  if (!mesh.vertexCount) return null;

  const atomPositions = new Float32Array(atoms.count * 3);
  for (let k = 0; k < atoms.count; k++) { atomPositions[k * 3] = atoms.x[k]; atomPositions[k * 3 + 1] = atoms.y[k]; atomPositions[k * 3 + 2] = atoms.z[k]; }
  const cellSize = field.maxRadius + field.level + field.resolution;
  const local = nearestAtomAttribution(mesh.positions, atomPositions, cellSize);
  // Re-express attribution in the caller's atom-row space, not the local gather order.
  const sourceAtom = Uint32Array.from(local, k => indices[k]);

  return { ...mesh, sourceAtom };
}
