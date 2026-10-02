import { activeAtoms, atomRadii } from "@molgpu/table";
import { molecularSurfaceField, structureFromBcif } from "@molgpu/io";
import { marchingCubes } from "@molgpu/geo";
import { gpuSesField } from "../../src/internal/ses-field.ts";

declare global {
  var runSesField: (id: string) => Promise<Record<string, unknown>>;
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
