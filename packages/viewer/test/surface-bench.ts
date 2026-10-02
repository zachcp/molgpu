// Moving-surface cost of <Surface> (molgpu-sept-t1s, molgpu-sept-mqo).
// Run: deno run -A packages/viewer/test/surface-bench.ts
// Times each stage the CPU path runs per coordinate generation (gather, Mol*
// SES field, marching cubes, nearest-atom attribution), the whole
// buildSurfaceGeometry call, and the GPU path (gpuSurfaceGeometry from packed
// GPU coordinates, when Deno has a WebGPU adapter), on warm jittered frames of
// corpus proteins.
import { activeAtoms, atomRadii, withPositions } from "@molgpu/table";
import { molecularSurfaceField, structureFromBcif } from "@molgpu/io";
import { marchingCubes, nearestAtomAttribution } from "@molgpu/geo";
import { buildSurfaceGeometry } from "../src/internal/surface-geometry.ts";
import {
  destroyGpuSurfaceMesh,
  gpuSurfaceGeometry,
} from "../src/internal/surface-gpu.ts";
import type { StructureResource } from "../src/types.ts";

const FRAMES = 6;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

let seed = 7;
const jitter = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return (seed / 2147483648 - 0.5) * 0.2;
};

const adapter = await navigator.gpu?.requestAdapter();
const device = adapter ? await adapter.requestDevice() : null;

const rows = [];
for (const id of ["1crn", "1ejg", "1tqn", "1a4y", "4c7r"]) {
  const bytes = await Deno.readFile(
    new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
  );
  const base = await structureFromBcif(bytes);
  const indices = activeAtoms(base);
  const stage: Record<string, number[]> = {
    gather: [],
    field: [],
    mesh: [],
    attribute: [],
    total: [],
    gpu: [],
  };
  let gridBytes = 0, meshBytes = 0, vertices = 0;
  for (let frame = 0; frame <= FRAMES; frame++) {
    const data = withPositions(base, base.positions.map((v) => v + jitter()));
    let t = performance.now();
    const radii = atomRadii(data);
    const n = indices.length;
    const atoms = {
      x: new Float32Array(n),
      y: new Float32Array(n),
      z: new Float32Array(n),
      radius: new Float32Array(n),
      count: n,
    };
    for (let k = 0; k < n; k++) {
      const i = indices[k];
      atoms.x[k] = data.positions[i * 3];
      atoms.y[k] = data.positions[i * 3 + 1];
      atoms.z[k] = data.positions[i * 3 + 2];
      atoms.radius[k] = radii[i];
    }
    const gather = performance.now() - t;
    t = performance.now();
    const field = await molecularSurfaceField(atoms, {
      probeRadius: 1.4,
      resolution: 0.5,
    });
    const fieldMs = performance.now() - t;
    t = performance.now();
    const mesh = marchingCubes({
      values: field.values,
      dims: field.dims,
      level: field.level,
      transform: field.transform,
    });
    const meshMs = performance.now() - t;
    t = performance.now();
    const points = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      points[k * 3] = atoms.x[k];
      points[k * 3 + 1] = atoms.y[k];
      points[k * 3 + 2] = atoms.z[k];
    }
    nearestAtomAttribution(
      mesh.positions,
      points,
      field.maxRadius + field.level + field.resolution,
    );
    const attribute = performance.now() - t;
    t = performance.now();
    await buildSurfaceGeometry({ data } as StructureResource, { indices });
    const total = performance.now() - t;
    let gpu = NaN;
    if (device) {
      const buffer = device.createBuffer({
        size: data.positions.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, data.positions);
      await device.queue.onSubmittedWorkDone();
      t = performance.now();
      const mesh = await gpuSurfaceGeometry(device, buffer, {
        atomCount: data.topology.atoms.count,
        rows: indices,
        radii,
      });
      gpu = performance.now() - t;
      if (mesh) destroyGpuSurfaceMesh(mesh);
      buffer.destroy();
    }
    if (frame === 0) continue; // first frame loads Mol* and warms the JIT
    stage.gather.push(gather);
    stage.field.push(fieldMs);
    stage.mesh.push(meshMs);
    stage.attribute.push(attribute);
    stage.total.push(total);
    stage.gpu.push(gpu);
    gridBytes = field.values.byteLength;
    vertices = mesh.vertexCount;
    meshBytes = mesh.positions.byteLength + mesh.normals.byteLength +
      mesh.indices.byteLength + mesh.vertexCount * 4;
  }
  rows.push({
    id,
    atoms: indices.length,
    vertices,
    gatherMs: +median(stage.gather).toFixed(1),
    fieldMs: +median(stage.field).toFixed(1),
    meshMs: +median(stage.mesh).toFixed(1),
    attributeMs: +median(stage.attribute).toFixed(1),
    totalMs: +median(stage.total).toFixed(1),
    gpuTotalMs: +median(stage.gpu).toFixed(1),
    gridMiB: +(gridBytes / 2 ** 20).toFixed(1),
    meshMiB: +(meshBytes / 2 ** 20).toFixed(1),
  });
}
console.table(rows);
console.log(JSON.stringify(rows));
