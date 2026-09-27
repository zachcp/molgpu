import {
  activeAtoms,
  createStructure,
  dssp,
  withPositions,
} from "@molgpu/table";
import { prepareDsspLayout } from "@molgpu/dynamics";
import { structureFromBcif } from "@molgpu/io";
import { gpuDssp, GpuDsspOverflowError } from "../../src/gpu-dssp.ts";
import { dsspOverflowMode } from "../../src/gpu-dssp-provider.ts";

declare global {
  interface Window {
    benchmarkGpuDssp: (copies: number) => Promise<{
      atoms: number;
      residues: number;
      cpuMs: number;
      gpuMs: number;
      workingBytes: number;
      readbackBytes: number;
      mismatch: number;
      fallback: boolean;
    }>;
    runDenseDsspOverflow: () => Promise<{
      named: boolean;
      equal: boolean;
      sparseNamed: boolean;
      sparseReason: boolean;
      sparseEqual: boolean;
    }>;
    runDsspOverflowPolicy: () => [string, string, string];
    runGpuDssp: (id: string, model?: "first" | number) => Promise<{
      mismatch: [number, number, number][];
      near: number;
      bridges: number;
      residues: number;
      milliseconds: number;
      aborted?: boolean;
      stableFrame?: boolean;
      storageCopy?: boolean;
    }>;
  }
}

window.runDsspOverflowPolicy = () => {
  const root = {} as GPUBuffer;
  const live = {} as GPUBuffer;
  return [
    dsspOverflowMode(undefined, root, 1, root, 1),
    dsspOverflowMode(undefined, live, 2, root, 1),
    dsspOverflowMode("frame", root, 1, root, 1),
  ];
};

window.benchmarkGpuDssp = async (copies: number) => {
  const response = await fetch("/1crn.bcif");
  const source = await structureFromBcif(
    new Uint8Array(await response.arrayBuffer()),
  );
  const baseAtoms = source.topology.atoms.count;
  const baseResidues = source.topology.residues.count;
  const atoms = baseAtoms * copies;
  const residues = baseResidues * copies;
  const width = Math.ceil(Math.cbrt(copies));
  const positions = new Float32Array(atoms * 3);
  const atomResidue = new Uint32Array(atoms);
  const names: string[] = new Array(atoms);
  const ids: string[] = new Array(atoms);
  const altloc: string[] = new Array(atoms);
  const elements = new Uint8Array(atoms);
  const occupancy = new Float32Array(atoms);
  const bfactor = new Float32Array(atoms);
  const residueChain = new Uint32Array(residues);
  const labelSeq = new Int32Array(residues);
  const authSeq: string[] = new Array(residues);
  const insertionCode: string[] = new Array(residues);
  const comp: string[] = new Array(residues);
  const polymer: ("protein" | "rna" | "dna" | "other")[] = new Array(residues);
  const { atoms: originalAtoms, residues: originalResidues } = source.topology;
  for (let copy = 0; copy < copies; copy++) {
    const translation = [
      (copy % width) * 27,
      (Math.floor(copy / width) % width) * 27,
      Math.floor(copy / (width * width)) * 27,
    ];
    for (let row = 0; row < baseAtoms; row++) {
      const out = copy * baseAtoms + row;
      ids[out] = String(out + 1);
      names[out] = originalAtoms.name[row];
      altloc[out] = originalAtoms.altloc[row];
      atomResidue[out] = copy * baseResidues + originalAtoms.residue[row];
      elements[out] = originalAtoms.element[row];
      occupancy[out] = originalAtoms.occupancy[row];
      bfactor[out] = originalAtoms.bfactor[row];
      for (let axis = 0; axis < 3; axis++) {
        positions[out * 3 + axis] = source.positions[row * 3 + axis] +
          translation[axis];
      }
    }
    for (let row = 0; row < baseResidues; row++) {
      const out = copy * baseResidues + row;
      residueChain[out] = copy;
      labelSeq[out] = originalResidues.labelSeq[row];
      authSeq[out] = originalResidues.authSeq[row];
      insertionCode[out] = originalResidues.insertionCode[row];
      comp[out] = originalResidues.comp[row];
      polymer[out] = originalResidues.polymer[row];
    }
  }
  const transforms = new Float64Array(copies * 16);
  for (let copy = 0; copy < copies; copy++) {
    for (const diagonal of [0, 5, 10, 15]) transforms[copy * 16 + diagonal] = 1;
  }
  const data = createStructure({
    positions,
    topology: {
      atoms: {
        count: atoms,
        id: ids,
        name: names,
        altloc,
        residue: atomResidue,
        element: elements,
        occupancy,
        bfactor,
      },
      residues: {
        count: residues,
        chain: residueChain,
        labelSeq,
        authSeq,
        insertionCode,
        comp,
        polymer,
      },
      chains: {
        count: copies,
        model: new Int32Array(copies).fill(1),
        labelId: Array.from({ length: copies }, (_, i) => `A${i}`),
        authId: Array.from({ length: copies }, (_, i) => `A${i}`),
      },
      bonds: {
        count: 0,
        a: new Uint32Array(0),
        b: new Uint32Array(0),
        order: new Uint8Array(0),
        source: [],
      },
      instances: {
        count: copies,
        chain: Uint32Array.from({ length: copies }, (_, i) => i),
        operatorId: new Array(copies).fill("identity"),
        transform: transforms,
      },
    },
  });
  const rows = activeAtoms(data);
  const layout = prepareDsspLayout(data, rows);
  const cpuStart = performance.now();
  const expected = dssp(data, { rows });
  const cpuMs = performance.now() - cpuStart;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU unavailable");
  const device = await adapter.requestDevice();
  const coordinates = device.createBuffer({
    size: positions.byteLength,
    usage: 0x0080 | 0x0004 | 0x0008,
  });
  device.queue.writeBuffer(coordinates, 0, positions);
  const gpuStart = performance.now();
  const result = await gpuDssp(device, coordinates, {
    data,
    rows,
    layout,
    generation: 1,
    overflow: "frame",
  });
  const gpuMs = performance.now() - gpuStart;
  let mismatch = 0;
  for (let i = 0; i < residues; i++) {
    if (expected[i] !== result.codes[i]) mismatch++;
  }
  result.codeBuffer.destroy();
  coordinates.destroy();
  device.destroy();
  return {
    atoms,
    residues,
    cpuMs,
    gpuMs,
    workingBytes: result.workingBytes,
    readbackBytes: result.readbackBytes,
    mismatch,
    fallback: result.fallback,
  };
};

window.runDenseDsspOverflow = async () => {
  const count = 12;
  const names = ["N", "CA", "C", "O", "H"];
  const points = [[1, 0, 0], [0, 0, 0], [0, 1, 0], [0, 0, 0], [0.5, 0, 0]];
  const positions = Float32Array.from(
    { length: count * 15 },
    (_, i) => points[Math.floor(i / 3) % 5][i % 3],
  );
  const data = createStructure({
    positions,
    topology: {
      atoms: {
        count: count * 5,
        id: Array.from({ length: count * 5 }, (_, i) => String(i + 1)),
        name: Array.from({ length: count * 5 }, (_, i) => names[i % 5]),
        altloc: new Array(count * 5).fill(""),
        residue: Uint32Array.from(
          { length: count * 5 },
          (_, i) => Math.floor(i / 5),
        ),
        element: new Uint8Array(count * 5).fill(6),
        occupancy: new Float32Array(count * 5).fill(1),
        bfactor: new Float32Array(count * 5),
      },
      residues: {
        count,
        chain: new Uint32Array(count),
        labelSeq: Int32Array.from({ length: count }, (_, i) => i + 1),
        authSeq: Array.from({ length: count }, (_, i) => String(i + 1)),
        insertionCode: new Array(count).fill(""),
        comp: new Array(count).fill("GLY"),
        polymer: new Array(count).fill("protein"),
      },
      chains: {
        count: 1,
        model: new Int32Array([1]),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: 0,
        a: new Uint32Array(0),
        b: new Uint32Array(0),
        order: new Uint8Array(0),
        source: [],
      },
      instances: {
        count: 1,
        chain: new Uint32Array(1),
        operatorId: ["identity"],
        transform: Float64Array.from([
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
        ]),
      },
    },
  });
  const rows = activeAtoms(data);
  const layout = prepareDsspLayout(data, rows);
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU unavailable");
  const device = await adapter.requestDevice();
  const coordinates = device.createBuffer({
    size: positions.byteLength,
    usage: 0x0080 | 0x0004 | 0x0008,
  });
  device.queue.writeBuffer(coordinates, 0, positions);
  let named = false;
  try {
    await gpuDssp(device, coordinates, {
      data,
      rows,
      layout,
      generation: 1,
      overflow: "static",
    });
  } catch (error) {
    named = error instanceof GpuDsspOverflowError &&
      error.message.includes("H-bond list");
  }
  const result = await gpuDssp(device, coordinates, {
    data,
    rows,
    layout,
    generation: 2,
    overflow: "frame",
  });
  const expected = dssp(data, { rows });
  const equal = result.fallback &&
    result.codes.every((v, i) => v === expected[i]);
  result.codeBuffer.destroy();
  const sparsePositions = positions.slice();
  for (let atom = 0; atom < count * 5; atom++) {
    sparsePositions[atom * 3] += Math.floor(atom / 5) * 1000;
  }
  device.queue.writeBuffer(coordinates, 0, sparsePositions);
  let sparseNamed = false;
  try {
    await gpuDssp(device, coordinates, {
      data,
      rows,
      layout,
      generation: 3,
      overflow: "static",
    });
  } catch (error) {
    sparseNamed = error instanceof GpuDsspOverflowError &&
      error.message.includes("sparse cell grid");
  }
  const sparse = await gpuDssp(device, coordinates, {
    data,
    rows,
    layout,
    generation: 4,
    overflow: "frame",
  });
  const sparseExpected = dssp(withPositions(data, sparsePositions), { rows });
  const sparseReason = sparse.fallbackReason === "sparse cell grid";
  const sparseEqual = sparse.fallback &&
    sparse.codes.every((v, i) => v === sparseExpected[i]);
  sparse.codeBuffer.destroy();
  coordinates.destroy();
  device.destroy();
  return { named, equal, sparseNamed, sparseReason, sparseEqual };
};

window.runGpuDssp = async (id: string, model: "first" | number = "first") => {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU adapter unavailable");
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (event) => {
    console.error("WebGPU", (event as GPUUncapturedErrorEvent).error.message);
  });
  const response = await fetch(`/${id}.bcif`);
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const data = await structureFromBcif(
    new Uint8Array(await response.arrayBuffer()),
  );
  const rows = activeAtoms(data, { model, altloc: "all" });
  const layout = prepareDsspLayout(data, rows);
  const coordinates = device.createBuffer({
    size: data.positions.byteLength,
    usage: 0x0080 | 0x0004 | 0x0008,
  });
  device.queue.writeBuffer(coordinates, 0, data.positions);
  const start = performance.now();
  const result = await gpuDssp(device, coordinates, {
    data,
    rows,
    layout,
    generation: 1,
  });
  const milliseconds = performance.now() - start;
  const expected = dssp(data, { rows });
  const mismatch: [number, number, number][] = [];
  for (let r = 0; r < expected.length; r++) {
    if (result.codes[r] !== expected[r]) {
      mismatch.push([r, expected[r], result.codes[r]]);
    }
  }
  let aborted: boolean | undefined;
  let stableFrame: boolean | undefined;
  let storageCopy: boolean | undefined;
  if (id === "1crn") {
    const controller = new AbortController();
    const pending = gpuDssp(device, coordinates, {
      data,
      rows,
      layout,
      generation: 2,
      signal: controller.signal,
    });
    controller.abort();
    try {
      const stale = await pending;
      stale.codeBuffer.destroy();
      aborted = false;
    } catch (error) {
      aborted = error instanceof DOMException && error.name === "AbortError";
    }
    // Mutate the live source after the bounds readback, before the second
    // submission. All DSSP stages must still use the first frame's snapshot.
    const originalMap = GPUBuffer.prototype.mapAsync;
    let mutated = false;
    GPUBuffer.prototype.mapAsync = function (...args) {
      const mapped = originalMap.apply(this, args);
      if (this.label !== "molgpu:dssp:bounds-readback") return mapped;
      return mapped.then(async () => {
        device.queue.writeBuffer(
          coordinates,
          0,
          new Float32Array(data.positions.length),
        );
        await device.queue.onSubmittedWorkDone();
        mutated = true;
      });
    };
    try {
      const stable = await gpuDssp(device, coordinates, {
        data,
        rows,
        layout,
        generation: 3,
      });
      stableFrame = mutated &&
        stable.codes.every((code, i) => code === expected[i]);
      stable.codeBuffer.destroy();
    } finally {
      GPUBuffer.prototype.mapAsync = originalMap;
    }
    // use.gpu RawData positions lack COPY_SRC: freeze them by storage copy.
    const storageOnly = device.createBuffer({
      size: data.positions.byteLength,
      usage: 0x0080 | 0x0008,
    });
    device.queue.writeBuffer(storageOnly, 0, data.positions);
    const copied = await gpuDssp(device, storageOnly, {
      data,
      rows,
      layout,
      generation: 4,
    });
    storageCopy = copied.codes.every((code, i) => code === expected[i]);
    copied.codeBuffer.destroy();
    storageOnly.destroy();
  }
  result.codeBuffer.destroy();
  coordinates.destroy();
  device.destroy();
  return {
    mismatch,
    near: result.nearThresholdCenters,
    bridges: result.bridgeCount,
    residues: layout.residueCount,
    milliseconds,
    aborted,
    stableFrame,
    storageCopy,
  };
};
