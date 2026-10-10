import { activeAtoms, atomRadii } from "@molgpu/table";
import { molecularSurfaceField, structureFromBcif } from "@molgpu/io";
import { marchingCubes, nearestAtomAttribution } from "@molgpu/geo";
import { gpuSesField } from "../../src/representations/surface/ses-field.ts";
import { gpuMarchingCubes } from "../../src/representations/surface/marching-cubes-gpu.ts";
import { encodeAttribution } from "../../src/representations/surface/attribution-gpu.ts";

declare global {
  var runSesField: (id: string) => Promise<Record<string, unknown>>;
  var runMarchingCubes: (id: string) => Promise<Record<string, unknown>>;
  var runAttribution: (id: string) => Promise<Record<string, unknown>>;
}

/** Total triangle area of an indexed mesh. */
function area(positions: Float32Array, indices: Uint32Array): number {
  let total = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a],
      uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a],
      vy = positions[c + 1] - positions[a + 1],
      vz = positions[c + 2] - positions[a + 2];
    total += 0.5 * Math.hypot(
      uy * vz - uz * vy,
      uz * vx - ux * vz,
      ux * vy - uy * vx,
    );
  }
  return total;
}

let device: GPUDevice;

globalThis.runSesField = async (id: string) => {
  if (!device) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    device = await adapter.requestDevice();
  }
  const bytes = new Uint8Array(
    await (await fetch(`/${id}.bcif`)).arrayBuffer(),
  );
  const data = await structureFromBcif(bytes);
  const rows = activeAtoms(data);
  const radii = atomRadii(data);
  const atomCount = data.topology.atoms.count;
  const positions = device.createBuffer({
    size: atomCount * 12,
    usage: 0x0080 | 0x0008,
  });
  device.queue.writeBuffer(positions, 0, data.positions as BufferSource);

  const options = { atomCount, rows, radii };
  const errors: string[] = [];
  device.pushErrorScope("validation");
  // The first call builds pipelines; time the second.
  (await gpuSesField(device, positions, options))!.field.destroy();
  const t0 = performance.now();
  const gpu = (await gpuSesField(device, positions, options))!;
  const gpuMs = performance.now() - t0;
  const scoped = await device.popErrorScope();
  if (scoped) errors.push(scoped.message);
  const samples = gpu.dims[0] * gpu.dims[1] * gpu.dims[2];
  const staging = device.createBuffer({
    size: samples * 4,
    usage: 0x0001 | 0x0008,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(gpu.field, 0, staging, 0, samples * 4);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(0x0001);
  const values = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  gpu.field.destroy();
  positions.destroy();

  const n = rows.length;
  const atoms = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    radius: new Float32Array(n),
    count: n,
  };
  rows.forEach((row, k) => {
    atoms.x[k] = data.positions[row * 3];
    atoms.y[k] = data.positions[row * 3 + 1];
    atoms.z[k] = data.positions[row * 3 + 2];
    atoms.radius[k] = radii[row];
  });
  const t1 = performance.now();
  const cpu = await molecularSurfaceField(atoms, {
    probeRadius: 1.4,
    resolution: 0.5,
  });
  const cpuMs = performance.now() - t1;

  let visitedMismatch = 0, differ = 0, maxDiff = 0;
  const sameGrid = cpu.values.length === samples;
  if (sameGrid) {
    for (let i = 0; i < samples; i++) {
      const a = values[i], b = cpu.values[i];
      if ((a > -1000) !== (b > -1000)) {
        visitedMismatch++;
        continue;
      }
      const d = Math.abs(a - b);
      if (d > 1e-3) differ++;
      if (d > maxDiff) maxDiff = d;
    }
  }
  const mesh = (v: Float32Array) =>
    marchingCubes({
      values: v,
      dims: cpu.dims,
      level: cpu.level,
      transform: cpu.transform,
    });
  const gpuMesh = sameGrid ? mesh(values) : null;
  const cpuMesh = mesh(cpu.values);
  return {
    id,
    atoms: n,
    samples,
    dims: [...gpu.dims],
    cpuDims: [...cpu.dims],
    transformDiff: Math.max(
      ...Array.from(gpu.transform, (v, i) => Math.abs(v - cpu.transform[i])),
    ),
    probes: gpu.probeCount,
    visitedMismatch,
    differ,
    maxDiff,
    gpuVertices: gpuMesh?.vertexCount ?? -1,
    cpuVertices: cpuMesh.vertexCount,
    gpuArea: gpuMesh ? area(gpuMesh.positions, gpuMesh.indices) : -1,
    cpuArea: area(cpuMesh.positions, cpuMesh.indices),
    gpuMs,
    cpuMs,
    workingBytes: gpu.workingBytes,
    readbackBytes: gpu.readbackBytes,
    errors,
  };
};

async function readBuffer(buffer: GPUBuffer, bytes: number) {
  const staging = device.createBuffer({ size: bytes, usage: 0x0001 | 0x0008 });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(0x0001);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}

/**
 * The GPU mesh of the GPU field against geo's marchingCubes of the same field
 * read back: identical topology, positions and normals to f32 rounding.
 */
globalThis.runMarchingCubes = async (id: string) => {
  if (!device) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    device = await adapter.requestDevice();
  }
  const bytes = new Uint8Array(
    await (await fetch(`/${id}.bcif`)).arrayBuffer(),
  );
  const data = await structureFromBcif(bytes);
  const atomCount = data.topology.atoms.count;
  const positions = device.createBuffer({
    size: atomCount * 12,
    usage: 0x0080 | 0x0008,
  });
  device.queue.writeBuffer(positions, 0, data.positions as BufferSource);
  const options = {
    atomCount,
    rows: activeAtoms(data),
    radii: atomRadii(data),
  };
  const errors: string[] = [];
  device.pushErrorScope("validation");
  const field = (await gpuSesField(device, positions, options))!;
  const mcOptions = {
    dims: field.dims,
    level: field.level,
    transform: field.transform,
  };
  // Warm the pipelines, then time a field + mesh rebuild.
  const warm = (await gpuMarchingCubes(device, field.field, mcOptions))!;
  for (const b of [warm.positions, warm.normals, warm.indices]) b.destroy();
  field.field.destroy();
  const t0 = performance.now();
  const timed = (await gpuSesField(device, positions, options))!;
  const t1 = performance.now();
  const mesh = (await gpuMarchingCubes(device, timed.field, mcOptions))!;
  const t2 = performance.now();
  const scoped = await device.popErrorScope();
  if (scoped) errors.push(scoped.message);
  const samples = timed.dims[0] * timed.dims[1] * timed.dims[2];
  const values = new Float32Array(await readBuffer(timed.field, samples * 4));
  const gpuPositions = new Float32Array(
    await readBuffer(mesh.positions, mesh.vertexCount * 12),
  );
  const gpuNormals = new Float32Array(
    await readBuffer(mesh.normals, mesh.vertexCount * 12),
  );
  const gpuIndices = new Uint32Array(
    await readBuffer(mesh.indices, mesh.triangleCount * 12),
  );
  for (const b of [mesh.positions, mesh.normals, mesh.indices, timed.field]) {
    b.destroy();
  }
  positions.destroy();
  const t3 = performance.now();
  const cpu = marchingCubes({ values, ...mcOptions });
  const cpuMs = performance.now() - t3;
  let indexMismatch = gpuIndices.length === cpu.indices.length ? 0 : -1;
  if (!indexMismatch) {
    for (let i = 0; i < gpuIndices.length; i++) {
      if (gpuIndices[i] !== cpu.indices[i]) indexMismatch++;
    }
  }
  let positionDiff = 0, normalDot = 1;
  if (mesh.vertexCount === cpu.vertexCount) {
    for (let v = 0; v < cpu.vertexCount * 3; v++) {
      positionDiff = Math.max(
        positionDiff,
        Math.abs(gpuPositions[v] - cpu.positions[v]),
      );
    }
    for (let v = 0; v < cpu.vertexCount; v++) {
      const a = cpu.normals.subarray(v * 3, v * 3 + 3);
      const b = gpuNormals.subarray(v * 3, v * 3 + 3);
      const length = Math.hypot(...a);
      if (length === 0) continue;
      normalDot = Math.min(
        normalDot,
        (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / length,
      );
    }
  }
  return {
    id,
    vertices: mesh.vertexCount,
    cpuVertices: cpu.vertexCount,
    triangles: mesh.triangleCount,
    indexMismatch,
    positionDiff,
    normalDot,
    fieldMs: t1 - t0,
    meshMs: t2 - t1,
    cpuMeshMs: cpuMs,
    meshBytes: mesh.vertexCount * 24 + mesh.triangleCount * 12,
    workingBytes: mesh.workingBytes,
    errors,
  };
};

/**
 * GPU attribution of the GPU mesh against geo's nearestAtomAttribution of the
 * same vertices: the same row except at f32 distance ties.
 */
globalThis.runAttribution = async (id: string) => {
  if (!device) {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    device = await adapter.requestDevice();
  }
  const bytes = new Uint8Array(
    await (await fetch(`/${id}.bcif`)).arrayBuffer(),
  );
  const data = await structureFromBcif(bytes);
  const atomCount = data.topology.atoms.count;
  const positions = device.createBuffer({
    size: atomCount * 12,
    usage: 0x0080 | 0x0008,
  });
  device.queue.writeBuffer(positions, 0, data.positions as BufferSource);
  const rows = activeAtoms(data);
  const options = {
    atomCount,
    rows,
    radii: atomRadii(data),
    retainCells: true,
  };
  const errors: string[] = [];
  device.pushErrorScope("validation");
  const run = async () => {
    const field = (await gpuSesField(device, positions, options))!;
    const mesh = (await gpuMarchingCubes(device, field.field, {
      dims: field.dims,
      level: field.level,
      transform: field.transform,
    }))!;
    const encoder = device.createCommandEncoder();
    const { sourceAtom, params } = encodeAttribution(
      device,
      encoder,
      mesh.positions,
      mesh.vertexCount,
      field.cells!,
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    params.destroy();
    field.field.destroy();
    for (const b of field.cells!.buffers) b.destroy();
    return { mesh, sourceAtom, field };
  };
  const warm = await run();
  for (
    const b of [
      warm.mesh.positions,
      warm.mesh.normals,
      warm.mesh.indices,
      warm.sourceAtom,
    ]
  ) b.destroy();
  const t0 = performance.now();
  const { mesh, sourceAtom, field } = await run();
  const totalMs = performance.now() - t0;
  const scoped = await device.popErrorScope();
  if (scoped) errors.push(scoped.message);
  const vertices = new Float32Array(
    await readBuffer(mesh.positions, mesh.vertexCount * 12),
  );
  const gpu = new Uint32Array(
    await readBuffer(sourceAtom, mesh.vertexCount * 4),
  );
  for (const b of [mesh.positions, mesh.normals, mesh.indices, sourceAtom]) {
    b.destroy();
  }
  positions.destroy();
  const atoms = new Float32Array(rows.length * 3);
  rows.forEach((row, k) =>
    atoms.set(data.positions.subarray(row * 3, row * 3 + 3), k * 3)
  );
  const t1 = performance.now();
  const local = nearestAtomAttribution(
    vertices,
    atoms,
    field.maxRadius + field.level + field.resolution,
  );
  const cpuMs = performance.now() - t1;
  let ties = 0, mismatches = 0;
  const dist = (v: number, row: number) =>
    Math.hypot(
      vertices[v * 3] - data.positions[row * 3],
      vertices[v * 3 + 1] - data.positions[row * 3 + 1],
      vertices[v * 3 + 2] - data.positions[row * 3 + 2],
    );
  for (let v = 0; v < mesh.vertexCount; v++) {
    const cpuRow = rows[local[v]];
    if (gpu[v] === cpuRow) continue;
    if (Math.abs(dist(v, gpu[v]) - dist(v, cpuRow)) < 1e-5) ties++;
    else mismatches++;
  }
  return {
    id,
    vertices: mesh.vertexCount,
    ties,
    mismatches,
    totalMs,
    cpuAttributionMs: cpuMs,
    errors,
  };
};
