// The GPU build of a <Surface> mesh from packed GPU coordinates: Mol*'s SES
// field, marching cubes, then nearest-atom attribution over the same frozen
// coordinates. Equivalent to buildSurfaceGeometry (the CPU reference) to f32
// rounding; the browser suite compares each stage on the protein corpus.
import { gpuSesField } from "./ses-field.ts";
import { gpuMarchingCubes } from "./marching-cubes-gpu.ts";
import { encodeAttribution } from "./attribution-gpu.ts";

export interface GpuSurfaceParams {
  readonly atomCount: number;
  /** Selected atom rows. */
  readonly rows: Uint32Array;
  /** Van der Waals radius per row. */
  readonly radii: Float32Array;
  readonly probeRadius?: number;
  readonly resolution?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

/** A surface mesh in GPU buffers, which the caller owns and destroys. */
export interface GpuSurfaceMesh {
  /** Packed vec3 f32 positions and normals, u32 indices. */
  readonly positions: GPUBuffer;
  readonly normals: GPUBuffer;
  readonly indices: GPUBuffer;
  /** The nearest selected atom row per vertex (u32). */
  readonly sourceAtom: GPUBuffer;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** Destroy every buffer of a mesh. */
export function destroyGpuSurfaceMesh(mesh: GpuSurfaceMesh): void {
  mesh.positions.destroy();
  mesh.normals.destroy();
  mesh.indices.destroy();
  mesh.sourceAtom.destroy();
}

/**
 * Build the surface of `rows` from `positions`. Returns null for an empty
 * selection or a field with no isosurface. Throws a RangeError where the GPU
 * port does not apply (a probe below two resolution steps, an atom with too
 * many neighbours), so the caller can use the CPU build instead.
 */
export async function gpuSurfaceGeometry(
  device: GPUDevice,
  positions: GPUBuffer,
  params: GpuSurfaceParams,
): Promise<GpuSurfaceMesh | null> {
  const field = await gpuSesField(device, positions, {
    ...params,
    retainCells: true,
  });
  if (!field) return null;
  try {
    const mesh = await gpuMarchingCubes(device, field.field, {
      dims: field.dims,
      level: field.level,
      transform: field.transform,
      ...(params.signal ? { signal: params.signal } : {}),
    });
    if (!mesh) return null;
    let attributionParams: GPUBuffer | null = null;
    try {
      const encoder = device.createCommandEncoder();
      const { sourceAtom, params: uniform } = encodeAttribution(
        device,
        encoder,
        mesh.positions,
        mesh.vertexCount,
        field.cells!,
      );
      attributionParams = uniform;
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      if (params.signal?.aborted) {
        sourceAtom.destroy();
        throw new DOMException("GPU surface was replaced", "AbortError");
      }
      return {
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        sourceAtom,
        vertexCount: mesh.vertexCount,
        triangleCount: mesh.triangleCount,
      };
    } catch (error) {
      mesh.positions.destroy();
      mesh.normals.destroy();
      mesh.indices.destroy();
      throw error;
    } finally {
      attributionParams?.destroy();
    }
  } finally {
    field.field.destroy();
    for (const buffer of field.cells?.buffers ?? []) buffer.destroy();
  }
}
