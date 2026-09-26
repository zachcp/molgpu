// Pure(ish) build step for <Surface>: gather selected atoms, preflight the
// grid budget, compute the scalar field (the sole @molgpu/io Mol* runtime
// boundary this package reaches through), extract the isosurface
// (@molgpu/geo's marching-cubes port), and attribute each vertex to its
// nearest source atom (@molgpu/geo). Not itself pure — it awaits an async
// io call — but has no Live/GPU dependency, so it is the kernel a
// useGeometryJob (0sj.7) call wraps.
import {
  marchingCubes,
  type MarchingCubesMesh,
  nearestAtomAttribution,
} from "@molgpu/geo";
import { atomRadii, type StructureData } from "@molgpu/table";
import type { SurfaceFieldAtoms } from "@molgpu/io";
import type { StructureResource } from "../types.ts";
import { assertGridBudget } from "./geometry-job.ts";
import { count } from "./instrumentation.ts";

/** The geometry-only parameters of a surface build (never colour or opacity). */
export interface SurfaceParams {
  readonly indices: Uint32Array;
  readonly probeRadius?: number;
  readonly resolution?: number;
  readonly maxBytes?: number;
}
/** A surface mesh with each vertex's nearest source atom row. */
export type SurfaceGeometry = MarchingCubesMesh & {
  readonly sourceAtom: Uint32Array;
};
type GatheredAtoms = SurfaceFieldAtoms & { readonly maxRadius: number };

function gatherAtoms(data: StructureData, indices: Uint32Array): GatheredAtoms {
  count("gathers", "surface:atoms");
  const n = indices.length;
  const x = new Float32Array(n),
    y = new Float32Array(n),
    z = new Float32Array(n),
    radius = new Float32Array(n);
  let maxRadius = 0;
  const R = atomRadii(data);
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    x[k] = data.positions[i * 3];
    y[k] = data.positions[i * 3 + 1];
    z[k] = data.positions[i * 3 + 2];
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
function predictGridDims(
  { x, y, z, maxRadius, count }: GatheredAtoms,
  resolution: number,
): [number, number, number] {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < count; k++) {
    min[0] = Math.min(min[0], x[k]);
    max[0] = Math.max(max[0], x[k]);
    min[1] = Math.min(min[1], y[k]);
    max[1] = Math.max(max[1], y[k]);
    min[2] = Math.min(min[2], z[k]);
    max[2] = Math.max(max[2], z[k]);
  }
  const pad = maxRadius + resolution;
  const cells = (c: number): number =>
    Math.max(2, Math.ceil((max[c] - min[c] + 2 * pad) / resolution));
  return [cells(0), cells(1), cells(2)];
}

/**
 * `resource`/`params` match useGeometryJob's kernel(resource, params)
 * contract. `params.indices` is the atom selection; `params.probeRadius`/
 * `params.resolution` are the geometry-only parameters (see geometryDeps —
 * color/opacity must never reach here). Returns null when the selection is
 * empty or produced no isosurface (e.g. atoms too sparse for the isolevel).
 */
export async function buildSurfaceGeometry(
  resource: StructureResource,
  params: SurfaceParams,
): Promise<SurfaceGeometry | null> {
  const { indices, probeRadius = 1.4, resolution = 0.5, maxBytes } = params;
  const { data } = resource;
  if (!indices.length) return null;
  count("geometryBuilds", "surface:mesh");
  const atoms = gatherAtoms(data, indices);
  assertGridBudget(
    predictGridDims(atoms, resolution),
    maxBytes !== undefined ? { maxBytes } : {},
  );

  const { molecularSurfaceField } = await import("@molgpu/io");
  const field = await molecularSurfaceField(atoms, { probeRadius, resolution });
  // No sentinel clamp here: Mol*'s own molecular-surface-mesh.js visual feeds
  // its field straight into marching cubes with no such step, and matches —
  // the -1001 fill value only matters for dual-contouring's gradient-based
  // normal estimate (see docs/findings/2026-09-15-s3-molecular-surface.md),
  // not for marching cubes, which only interpolates across a real crossing.
  const mesh = marchingCubes({
    values: field.values,
    dims: field.dims,
    level: field.level,
    transform: field.transform,
  });
  if (!mesh.vertexCount) return null;

  const atomPositions = new Float32Array(atoms.count * 3);
  for (let k = 0; k < atoms.count; k++) {
    atomPositions[k * 3] = atoms.x[k];
    atomPositions[k * 3 + 1] = atoms.y[k];
    atomPositions[k * 3 + 2] = atoms.z[k];
  }
  const cellSize = field.maxRadius + field.level + field.resolution;
  const local = nearestAtomAttribution(mesh.positions, atomPositions, cellSize);
  // Re-express attribution in the caller's atom-row space, not the local gather order.
  const sourceAtom = Uint32Array.from(local, (k) => indices[k]);

  return { ...mesh, sourceAtom };
}
