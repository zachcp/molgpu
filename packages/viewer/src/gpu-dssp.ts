import {
  cellListWgsl,
  type DsspBridge,
  type DsspLayout,
  dsspWgsl,
  finishDssp,
  planCellList,
} from "@molgpu/dynamics";
import { dssp, type StructureData, withPositions } from "@molgpu/table";

const MAP_READ = 0x0001;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const STORAGE = 0x0080;
const GROUP = 64;

type PipelineName =
  | keyof typeof dsspWgsl
  | "cellBounds"
  | "cellMergeBounds"
  | "cellCount"
  | "cellScanCounts"
  | "cellScanValues"
  | "cellAddOffsets"
  | "cellScatter"
  | "alpha"
  | "threeTen"
  | "pi";
const pipelines = new WeakMap<
  GPUDevice,
  Map<PipelineName, GPUComputePipeline>
>();

function pipeline(device: GPUDevice, name: PipelineName): GPUComputePipeline {
  let cache = pipelines.get(device);
  if (!cache) pipelines.set(device, cache = new Map());
  let result = cache.get(name);
  if (result) return result;
  const cell = name.startsWith("cell");
  const code = cell
    ? cellListWgsl[
      (name.slice(4, 5).toLowerCase() +
        name.slice(5)) as keyof typeof cellListWgsl
    ]
    : dsspWgsl[
      (name === "alpha" || name === "threeTen" || name === "pi"
        ? "helix"
        : name) as keyof typeof dsspWgsl
    ];
  if (typeof code !== "string") {
    throw new Error(`Unknown GPU DSSP stage ${name}`);
  }
  result = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: device.createShaderModule({ code, label: `molgpu:dssp:${name}` }),
      entryPoint: name === "alpha" || name === "threeTen" || name === "pi"
        ? name
        : "main",
    },
    label: `molgpu:dssp:${name}`,
  });
  cache.set(name, result);
  return result;
}

/** A bounded GPU stage could not preserve exact DSSP semantics. */
export class GpuDsspOverflowError extends RangeError {
  constructor(stage: string) {
    super(`GPU DSSP ${stage} overflow; exact CPU recomputation required`);
    this.name = "GpuDsspOverflowError";
  }
}

export interface GpuDsspResult {
  readonly codes: Uint8Array;
  /** f32 residue codes for AttributesContext GPU consumers; caller owns it. */
  readonly codeBuffer: GPUBuffer;
  readonly generation: number;
  readonly nearThresholdResidues: number;
  readonly bridgeCount: number;
  readonly fallback: boolean;
  /** Peak temporary allocation owned by this call, excluding input and output. */
  readonly workingBytes: number;
  /** GPU-to-CPU bytes copied for this generation. */
  readonly readbackBytes: number;
}

export interface GpuDsspOptions {
  readonly generation: number;
  readonly data: StructureData;
  readonly rows: ArrayLike<number>;
  readonly layout: DsspLayout;
  /** Static calculations throw by name; live frames read one full frame on overflow. */
  readonly overflow?: "static" | "frame";
  readonly maxBridges?: number;
  /** Cancels a superseded coordinate generation before another GPU pass. */
  readonly signal?: AbortSignal;
}

/** Compute DSSP directly from packed GPU coordinates of one model. */
export async function gpuDssp(
  device: GPUDevice,
  positions: GPUBuffer,
  options: GpuDsspOptions,
): Promise<GpuDsspResult> {
  const { data, rows, layout, generation } = options;
  const checkCurrent = () => {
    if (options.signal?.aborted) {
      throw new DOMException(
        "GPU DSSP coordinate generation was replaced",
        "AbortError",
      );
    }
  };
  checkCurrent();
  const m = layout.residueCount;
  if (layout.atomCount !== data.topology.atoms.count) {
    throw new TypeError("GPU DSSP layout belongs to another topology");
  }
  const transient: GPUBuffer[] = [];
  let workingBytes = 0;
  let readbackBytes = 0;
  const make = (
    size: number,
    usage: number,
    label: string,
    initial?: ArrayBufferView,
  ) => {
    const allocated = Math.max(16, Math.ceil(size / 4) * 4);
    const buffer = device.createBuffer({
      size: allocated,
      usage,
      label: `molgpu:dssp:${label}`,
    });
    transient.push(buffer);
    workingBytes += allocated;
    if (initial?.byteLength) {
      device.queue.writeBuffer(buffer, 0, initial as BufferSource);
    }
    return buffer;
  };
  const uploadCodes = (codes: Uint8Array): GPUBuffer => {
    const result = device.createBuffer({
      size: Math.max(16, 4 * codes.length),
      usage: STORAGE | COPY_SRC | COPY_DST,
      label: "molgpu:dssp:ssCode",
    });
    device.queue.writeBuffer(result, 0, Float32Array.from(codes));
    return result;
  };
  const bind = (
    name: PipelineName,
    entries: readonly [number, GPUBuffer][],
  ) => {
    const p = pipeline(device, name);
    return device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: entries.map(([binding, buffer]) => ({
        binding,
        resource: { buffer },
      })),
    });
  };
  const dispatch = (
    pass: GPUComputePassEncoder,
    name: PipelineName,
    entries: readonly [number, GPUBuffer][],
    groups: number,
  ) => {
    const p = pipeline(device, name);
    pass.setPipeline(p);
    pass.setBindGroup(0, bind(name, entries));
    pass.dispatchWorkgroups(groups);
  };
  const read = async (
    source: GPUBuffer,
    bytes: number,
  ): Promise<ArrayBuffer> => {
    readbackBytes += bytes;
    const staging = make(bytes, COPY_DST | MAP_READ, "readback");
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(MAP_READ);
    const copy = staging.getMappedRange().slice(0);
    staging.unmap();
    return copy;
  };
  const frameFallback = async (stage: string): Promise<GpuDsspResult> => {
    checkCurrent();
    if (options.overflow !== "frame") throw new GpuDsspOverflowError(stage);
    const buffer = await read(positions, data.topology.atoms.count * 12);
    const snapshot = withPositions(data, new Float32Array(buffer));
    const codes = dssp(snapshot, { rows });
    return {
      codes,
      codeBuffer: uploadCodes(codes),
      generation,
      nearThresholdResidues: 0,
      bridgeCount: 0,
      fallback: true,
      workingBytes,
      readbackBytes,
    };
  };
  try {
    if (!m || !layout.caMap.length) {
      const codes = new Uint8Array(layout.totalResidues);
      return {
        codes,
        codeBuffer: uploadCodes(codes),
        generation,
        nearThresholdResidues: 0,
        bridgeCount: 0,
        fallback: false,
        workingBytes,
        readbackBytes,
      };
    }
    const caCount = layout.caMap.length;
    const descriptors = make(
      layout.descriptors.byteLength,
      STORAGE | COPY_DST,
      "layout",
      layout.descriptors,
    );
    const caMap = make(
      layout.caMap.byteLength,
      STORAGE | COPY_DST,
      "ca-map",
      layout.caMap,
    );
    const ca = make(m * 12, STORAGE | COPY_SRC, "ca");
    const h = make(m * 16, STORAGE, "hydrogen");
    const params = make(64, UNIFORM | COPY_DST, "params");
    device.queue.writeBuffer(params, 0, Uint32Array.of(m, 0, 0, 0));
    const gather = device.createCommandEncoder();
    const gatherPass = gather.beginComputePass();
    dispatch(gatherPass, "gather", [
      [0, positions],
      [1, descriptors],
      [2, ca],
      [3, h],
      [7, params],
    ], Math.ceil(m / GROUP));
    gatherPass.end();

    // The Phase 13 reduction emits one 32-byte bound per group; merge until
    // one remains. The readback sizes the dense grid for this generation.
    let boundCount = caCount;
    let boundInput: GPUBuffer | null = null;
    let firstBounds = true;
    while (true) {
      const groups = Math.ceil(boundCount / GROUP);
      const output = make(groups * 32, STORAGE | COPY_SRC, "bounds");
      const boundParams = make(
        16,
        UNIFORM | COPY_DST,
        "bounds-params",
        Uint32Array.of(boundCount, 1, 0, 0),
      );
      const pass = gather.beginComputePass();
      if (firstBounds) {
        dispatch(pass, "cellBounds", [
          [0, ca],
          [1, caMap],
          [2, output],
          [3, boundParams],
        ], groups);
      } else {
        dispatch(pass, "cellMergeBounds", [
          [0, boundInput!],
          [2, output],
          [3, boundParams],
        ], groups);
      }
      pass.end();
      boundInput = output;
      if (groups === 1) break;
      boundCount = groups;
      firstBounds = false;
    }
    const boundStage = make(32, COPY_DST | MAP_READ, "bounds-readback");
    gather.copyBufferToBuffer(boundInput!, 0, boundStage, 0, 32);
    readbackBytes += 32;
    device.queue.submit([gather.finish()]);
    await boundStage.mapAsync(MAP_READ);
    const values = new Float32Array(boundStage.getMappedRange().slice(0));
    boundStage.unmap();
    checkCurrent();
    let plan;
    try {
      plan = planCellList(
        { generation, values },
        generation,
        caCount,
        9,
        device.limits.maxStorageBufferBindingSize,
        Math.max(1, caCount * 8),
      );
    } catch (error) {
      if (error instanceof RangeError) return await frameFallback("cell list");
      throw error;
    }
    if (!plan) throw new Error("GPU DSSP bounds generation changed");

    const cells = plan.cellCount;
    const cellIds = make(caCount * 4, STORAGE, "cell-ids");
    const counts = make((cells + 1) * 4, STORAGE | COPY_DST, "cell-counts");
    device.queue.writeBuffer(counts, 0, new Uint32Array(cells + 1));
    const sorted = make(caCount * 4, STORAGE, "sorted-ca");
    const cellParamsData = new ArrayBuffer(64);
    const ints = new Uint32Array(cellParamsData);
    const floats = new Float32Array(cellParamsData);
    ints.set([caCount, 1, 4096, 0, ...plan.dims, cells]);
    floats.set([...plan.origin, 0, 1 / plan.cellWidth, 81, 0, 0], 8);
    const cellParams = make(64, UNIFORM | COPY_DST, "cell-params", ints);
    const maxBridges = options.maxBridges ?? Math.max(16, 4 * m);
    if (!Number.isSafeInteger(maxBridges) || maxBridges < 1) {
      throw new TypeError("GPU DSSP maxBridges must be a positive integer");
    }
    const dsspParamData = new ArrayBuffer(64);
    const di = new Uint32Array(dsspParamData);
    const df = new Float32Array(dsspParamData);
    di.set([m, maxBridges, ...plan.dims]);
    df.set([...plan.origin, 0, 1 / plan.cellWidth, 0, 0, 0], 8);
    device.queue.writeBuffer(params, 0, dsspParamData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    dispatch(pass, "cellCount", [
      [0, ca],
      [1, caMap],
      [2, cellIds],
      [3, counts],
      [4, cellParams],
    ], Math.ceil(caCount / GROUP));
    pass.end();

    // Hierarchical exclusive scan of atomic cell counts. The extra zero
    // count yields offsets[cellCount] for the neighbour loops.
    interface ScanLevel {
      offsets: GPUBuffer;
      count: number;
    }
    const levels: ScanLevel[] = [];
    let input = counts;
    let scanCount = cells + 1;
    let atomic = true;
    while (true) {
      const groups = Math.ceil(scanCount / 256);
      const offsets = make(scanCount * 4, STORAGE | COPY_SRC, "offsets");
      const sums = make(groups * 4, STORAGE, "scan-sums");
      const scanParams = make(
        16,
        UNIFORM | COPY_DST,
        "scan-params",
        Uint32Array.of(scanCount, 0, 0, 0),
      );
      const scanPass = encoder.beginComputePass();
      dispatch(scanPass, atomic ? "cellScanCounts" : "cellScanValues", [
        [0, input],
        [1, offsets],
        [2, sums],
        [3, scanParams],
      ], groups);
      scanPass.end();
      levels.push({ offsets, count: scanCount });
      if (groups === 1) break;
      input = sums;
      scanCount = groups;
      atomic = false;
    }
    for (let level = levels.length - 2; level >= 0; level--) {
      const child = levels[level], parent = levels[level + 1];
      const scanParams = make(
        16,
        UNIFORM | COPY_DST,
        "add-params",
        Uint32Array.of(child.count, 0, 0, 0),
      );
      const add = encoder.beginComputePass();
      dispatch(add, "cellAddOffsets", [
        [0, child.offsets],
        [1, parent.offsets],
        [2, scanParams],
      ], Math.ceil(child.count / GROUP));
      add.end();
    }
    const offsets = levels[0].offsets;
    const cursor = make(cells * 4, STORAGE | COPY_DST, "cursor");
    encoder.copyBufferToBuffer(offsets, 0, cursor, 0, cells * 4);
    const scatter = encoder.beginComputePass();
    dispatch(scatter, "cellScatter", [
      [0, caMap],
      [1, cellIds],
      [2, cursor],
      [3, sorted],
      [4, cellParams],
    ], Math.ceil(caCount / GROUP));
    scatter.end();

    const bonds = make(m * 9 * 4, STORAGE, "bond-lists");
    const state = make(16, STORAGE | COPY_SRC | COPY_DST, "state");
    device.queue.writeBuffer(state, 0, new Uint32Array(4));
    const flagsA = make(m * 4, STORAGE | COPY_SRC, "flags-a");
    const flagsB = make(m * 4, STORAGE, "flags-b");
    const bridges = make(maxBridges * 24, STORAGE | COPY_SRC, "bridges");
    const stages = encoder.beginComputePass();
    dispatch(stages, "hbonds", [
      [0, positions],
      [1, descriptors],
      [2, ca],
      [3, h],
      [4, offsets],
      [5, sorted],
      [6, bonds],
      [7, params],
      [8, state],
    ], Math.ceil(m / GROUP));
    dispatch(stages, "turns", [
      [0, descriptors],
      [1, bonds],
      [2, flagsA],
      [7, params],
    ], Math.ceil(m / GROUP));
    dispatch(stages, "alpha", [
      [0, descriptors],
      [1, flagsA],
      [2, flagsB],
      [7, params],
    ], Math.ceil(m / GROUP));
    dispatch(stages, "threeTen", [
      [0, descriptors],
      [1, flagsB],
      [2, flagsA],
      [7, params],
    ], Math.ceil(m / GROUP));
    dispatch(stages, "pi", [
      [0, descriptors],
      [1, flagsA],
      [2, flagsB],
      [7, params],
    ], Math.ceil(m / GROUP));
    dispatch(stages, "bends", [
      [0, positions],
      [1, descriptors],
      [2, flagsB],
      [3, flagsA],
      [7, params],
    ], Math.ceil(m / GROUP));
    dispatch(stages, "bridges", [
      [0, descriptors],
      [1, bonds],
      [2, bridges],
      [3, state],
      [7, params],
    ], Math.ceil(m / GROUP));
    stages.end();
    device.queue.submit([encoder.finish()]);

    const [stateData, flagData] = await Promise.all([
      read(state, 16),
      read(flagsA, m * 4),
    ]);
    const status = new Uint32Array(stateData);
    checkCurrent();
    if (status[1]) return await frameFallback("H-bond list (8 donors)");
    if (status[2]) return await frameFallback("bridge list");
    if (status[3]) return await frameFallback("cell candidates");
    const bridgeCount = status[0];
    const bridgeData = bridgeCount
      ? new Uint32Array(await read(bridges, bridgeCount * 24))
      : new Uint32Array(0);
    checkCurrent();
    const bridgeList: DsspBridge[] = [];
    for (let i = 0; i < bridgeCount; i++) {
      bridgeList.push({
        partner1: bridgeData[i * 6],
        partner2: bridgeData[i * 6 + 1],
        type: bridgeData[i * 6 + 2],
        acceptor: bridgeData[i * 6 + 3],
        donor: bridgeData[i * 6 + 4],
        pattern: bridgeData[i * 6 + 5],
      });
    }
    const flags = new Uint32Array(flagData);
    let nearThresholdResidues = 0;
    for (const flag of flags) if (flag & 0x80000000) nearThresholdResidues++;
    const codes = finishDssp(layout, flags, bridgeList);
    return {
      codes,
      codeBuffer: uploadCodes(codes),
      generation,
      nearThresholdResidues,
      bridgeCount,
      fallback: false,
      workingBytes,
      readbackBytes,
    };
  } finally {
    for (const buffer of transient) buffer.destroy();
  }
}
