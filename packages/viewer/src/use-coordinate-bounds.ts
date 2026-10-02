// Bounds and centroid of the nearest coordinates, one reduction and readback
// per generation. Raw WebGPU, not use.gpu Readback: native Readback queues its
// copy in the renderer and carries no source or generation, which this hook
// publishes with each result (see
// docs/findings/2026-09-28-gpu-publication-contract.md and
// docs/findings/2026-10-02-native-compute-audit.md).
import { useMemo, useRef, useResource, useState } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import type { Selection } from "@molgpu/select";
import { useCoordinates } from "./coordinates-context.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";

const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const MAP_READ = 0x0001;
const STORAGE = 0x0080;
const UNIFORM = 0x0040;
const THREADS = 256;
const PARTIAL_BYTES = 48;

const SHADER = `
struct Parameters { count: u32, selected: u32, _pad0: u32, _pad1: u32 };
struct Partial { lo: vec4<f32>, hi: vec4<f32>, total: vec4<f32> };
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> rows: array<u32>;
@group(0) @binding(2) var<storage, read_write> parts: array<Partial>;
@group(0) @binding(3) var<uniform> params: Parameters;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let lane = id.x;
  var lo = vec3<f32>(1e30);
  var hi = vec3<f32>(-1e30);
  var total = vec3<f32>(0.0);
  var n = 0.0;
  for (var j = lane; j < params.count; j += ${THREADS}u) {
    var row = j;
    if (params.selected != 0u) { row = rows[j]; }
    let i = row * 3u;
    let p = vec3<f32>(positions[i], positions[i + 1u], positions[i + 2u]);
    lo = min(lo, p);
    hi = max(hi, p);
    total += p;
    n += 1.0;
  }
  parts[lane].lo = vec4<f32>(lo, 0.0);
  parts[lane].hi = vec4<f32>(hi, 0.0);
  parts[lane].total = vec4<f32>(total, n);
}`;

/** GPU-reduced bounds and centroid for a completed local coordinate generation. */
export interface CoordinateBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly centroid: readonly [number, number, number];
  readonly count: number;
  readonly generation: number;
}

function reduce(
  values: Float32Array,
  generation: number,
): CoordinateBounds | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const sum = [0, 0, 0];
  let n = 0;
  for (let lane = 0; lane < THREADS; lane++) {
    const i = lane * 12;
    if (!values[i + 11]) continue;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], values[i + axis]);
      max[axis] = Math.max(max[axis], values[i + 4 + axis]);
      sum[axis] += values[i + 8 + axis];
    }
    n += values[i + 11];
  }
  if (!n) return null;
  return Object.freeze({
    min: Object.freeze(min) as unknown as [number, number, number],
    max: Object.freeze(max) as unknown as [number, number, number],
    centroid: Object.freeze(sum.map((v) => v / n)) as unknown as [
      number,
      number,
      number,
    ],
    count: n,
    generation,
  });
}

/** Asynchronous GPU bounds and centroid for the nearest coordinate stream. */
export function useCoordinateBounds(
  selection: Selection | null = null,
): CoordinateBounds | null {
  const coordinates = useCoordinates();
  const device = useDeviceContext();
  if (
    selection && coordinates &&
    selection.dataset !== coordinates.resource.identity
  ) {
    throw new TypeError("useCoordinateBounds received a foreign selection");
  }
  const pipeline = useMemo(() =>
    device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({ code: SHADER }),
        entryPoint: "main",
      },
    }), [device]);
  const rows = selection?.indices ?? null;
  const buffers = useMemo(() => {
    const rowBuffer = device.createBuffer({
      size: Math.max(4, (rows?.length ?? 0) * 4),
      usage: STORAGE | COPY_DST,
      label: "molgpu:coords:bounds:rows",
    });
    if (rows?.length) device.queue.writeBuffer(rowBuffer, 0, rows);
    const params = device.createBuffer({
      size: 16,
      usage: UNIFORM | COPY_DST,
      label: "molgpu:coords:bounds:params",
    });
    const output = device.createBuffer({
      size: THREADS * PARTIAL_BYTES,
      usage: STORAGE | COPY_SRC,
      label: "molgpu:coords:bounds:output",
    });
    const staging = [0, 1].map(() =>
      device.createBuffer({
        size: THREADS * PARTIAL_BYTES,
        usage: COPY_DST | MAP_READ,
        label: "molgpu:coords:bounds:staging",
      })
    );
    return {
      rowBuffer,
      params,
      output,
      staging,
      alive: true,
      mapping: null as GPUBuffer | null,
    };
  }, [device, rows]);
  useResource((dispose) => {
    const all = [
      buffers.rowBuffer,
      buffers.params,
      buffers.output,
      ...buffers.staging,
    ];
    for (const buffer of all) trackOwnedBuffer(buffer, "coords:bounds");
    buffers.alive = true;
    dispose(() => {
      buffers.alive = false;
      for (const buffer of all) {
        releaseOwnedBuffer(buffer);
        // The asynchronous run owns its staging until map completion.
        if (buffer !== buffers.mapping) buffer.destroy();
      }
    });
  }, [buffers]);
  const [result, setResult] = useState<
    {
      value: CoordinateBounds | null;
      source: GPUBuffer;
      rows: Uint32Array | null;
    } | null
  >(null);
  const current = useRef(coordinates?.generation ?? -1);
  current.current = coordinates?.generation ?? -1;
  const next = useRef(0);
  const inFlight = useRef(false);
  useResource((dispose) => {
    if (!coordinates || coordinates.ready === false) return;
    let alive = true;
    const generation = coordinates.generation;
    const selected = rows !== null;
    let work: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (!alive || !buffers.alive) return;
      if (inFlight.current) {
        work = setTimeout(run, 16);
        return;
      }
      inFlight.current = true;
      const staging = buffers.staging[next.current++ % 2];
      buffers.mapping = staging;
      try {
        device.queue.writeBuffer(
          buffers.params,
          0,
          Uint32Array.of(
            selected ? rows.length : coordinates.count,
            selected ? 1 : 0,
            0,
            0,
          ),
        );
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: coordinates.source.buffer } },
            { binding: 1, resource: { buffer: buffers.rowBuffer } },
            { binding: 2, resource: { buffer: buffers.output } },
            { binding: 3, resource: { buffer: buffers.params } },
          ],
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(THREADS / 64);
        pass.end();
        encoder.copyBufferToBuffer(
          buffers.output,
          0,
          staging,
          0,
          THREADS * PARTIAL_BYTES,
        );
        device.queue.submit([encoder.finish()]);
        count("gathers", "coords:bounds:dispatch");
        await staging.mapAsync(MAP_READ);
        const values = new Float32Array(staging.getMappedRange().slice(0));
        staging.unmap();
        if (alive && generation === current.current) {
          setResult({
            value: reduce(values, generation),
            source: coordinates.source.buffer,
            rows,
          });
          count("gathers", "coords:bounds:publish");
        } else count("gathers", "coords:bounds:discard");
      } catch {
        if (alive) count("gathers", "coords:bounds:error");
      } finally {
        buffers.mapping = null;
        if (!buffers.alive) staging.destroy();
        inFlight.current = false;
      }
    };
    queueMicrotask(run);
    dispose(() => {
      alive = false;
      if (work) clearTimeout(work);
    });
  }, [
    coordinates?.source.buffer,
    coordinates?.generation,
    coordinates?.ready,
    rows,
    buffers,
    pipeline,
  ]);
  return result && result.source === coordinates?.source.buffer &&
      result.rows === rows
    ? result.value
    : null;
}
