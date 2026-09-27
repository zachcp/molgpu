// <Unwrap>: a coordinate provider that makes each covalent component whole on
// the displayed frame of a periodic system, optionally moving selected
// components into the primary cell. The traversal runs on the GPU against the
// same upstream generation (see unwrapWgsl in @molgpu/dynamics); the covalent
// spanning forest is built once per topology on the CPU.
import {
  type LC,
  type LiveElement,
  use,
  useMemo,
  useResource,
} from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import {
  createUnwrapForest,
  type PeriodicBox,
  periodicBox,
  UNWRAP_LINK_BYTES,
  UNWRAP_PARAMS_BYTES,
  type UnwrapForest,
  unwrapWgsl,
} from "@molgpu/dynamics";
import type { Topology } from "@molgpu/table";
import { useCoordinates } from "./coordinates-context.ts";
import { CoordinatePasses } from "./internal/coordinate-passes.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import { live, viewer } from "./internal/elements.ts";
import { useStatusReadback } from "./internal/status-readback.ts";
import { useTrajectoryFrame } from "./trajectory.ts";
import type { UnwrapProps, UnwrapStatus, ViewerComponent } from "./types.ts";
import { useCoordinateSelection } from "./use-coordinate-selection.ts";

const STORAGE = 0x0080;
const UNIFORM = 0x0040;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const GROUP = 64;
const MAX_GROUPS = 65535;
/** Lattice candidates per exact image search before it reports a limit. */
const MAX_CANDIDATES = 4096;

const ENTRIES = [
  "link",
  "jump",
  "propagate",
  "centerSums",
  "place",
  "rings",
] as const;
type Entry = typeof ENTRIES[number];
const pipelines = new WeakMap<GPUDevice, Record<Entry, GPUComputePipeline>>();

function unwrapPipelines(device: GPUDevice) {
  let cached = pipelines.get(device);
  if (!cached) {
    const module = device.createShaderModule({
      code: unwrapWgsl,
      label: "molgpu:unwrap",
    });
    cached = Object.fromEntries(ENTRIES.map((entryPoint) => [
      entryPoint,
      device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint },
        label: `molgpu:unwrap:${entryPoint}`,
      }),
    ])) as Record<Entry, GPUComputePipeline>;
    pipelines.set(device, cached);
  }
  return cached;
}

/** Forest plus a one-time level schedule (or deep-chain jump fallback). */
type Graph = {
  forest: UnwrapForest;
  rounds: number;
  levelRows: Uint32Array;
  levelStarts: Uint32Array;
  layered: boolean;
  id: number;
};
let nextGraph = 0;
const graphs = new WeakMap<Topology, Graph>();

function graphOf(topology: Topology): Graph {
  let graph = graphs.get(topology);
  if (!graph) {
    const forest = createUnwrapForest(topology);
    const depth = new Uint32Array(forest.atomCount);
    let deepest = 0;
    for (const row of forest.order) {
      const parent = forest.parent[row];
      if (parent < 0) continue;
      depth[row] = depth[parent] + 1;
      deepest = Math.max(deepest, depth[row]);
    }
    const layered = deepest <= 32;
    let starts = new Uint32Array(0), levelRows = new Uint32Array(0);
    if (layered) {
      const counts = new Uint32Array(deepest + 1);
      for (const row of forest.order) counts[depth[row]]++;
      starts = new Uint32Array(deepest + 2);
      for (let k = 0; k < counts.length; k++) {
        starts[k + 1] = starts[k] + counts[k];
      }
      const cursors = starts.slice();
      levelRows = new Uint32Array(forest.atomCount);
      for (const row of forest.order) levelRows[cursors[depth[row]]++] = row;
    }
    // After r rounds a pointer has climbed 2^r ancestors (the link stage
    // already points one up).
    let rounds = 0;
    while (2 ** rounds < deepest) rounds++;
    // Extremely deep chains would need too many serial dispatches; keep the
    // logarithmic fallback for them. Gate scenes have depth nine.
    graph = Object.freeze({
      forest,
      rounds,
      levelRows,
      levelStarts: starts,
      layered,
      id: ++nextGraph,
    });
    graphs.set(topology, graph);
  }
  return graph;
}

/** Center rows grouped by component, as `centerSums` reads them. */
function centerLayout(forest: UnwrapForest, rows: Uint32Array | null) {
  const byComponent = new Map<number, number[]>();
  for (const row of rows ?? []) {
    const id = forest.component[row];
    const list = byComponent.get(id);
    if (list) list.push(row);
    else byComponent.set(id, [row]);
  }
  const components = [...byComponent.keys()].sort((a, b) => a - b);
  const starts = new Uint32Array(components.length + 1);
  const ordered: number[] = [];
  components.forEach((id, k) => {
    ordered.push(...byComponent.get(id)!);
    starts[k + 1] = ordered.length;
  });
  return {
    components: Uint32Array.from(components),
    starts,
    rows: Uint32Array.from(ordered),
  };
}

const Unwrapped: LC<{
  box: PeriodicBox;
  centerRows: Uint32Array | null;
  centerKey: string;
  onStatus?: (status: UnwrapStatus) => void;
  children: LiveElement;
}> = ({ box, centerRows, centerKey, onStatus, children }) => {
  const upstream = useCoordinates()!;
  const device = useDeviceContext();
  const topology = upstream.resource.data.topology;
  const graph = useMemo(() => graphOf(topology), [topology]);
  const { forest } = graph;
  const n = upstream.count;
  const buffers = useMemo(() => {
    const layout = centerLayout(forest, centerRows);
    const made: GPUBuffer[] = [];
    const make = (
      size: number,
      usage: number,
      label: string,
      data?: ArrayBufferView,
    ) => {
      const buffer = device.createBuffer({
        size: Math.max(16, Math.ceil(size / 4) * 4),
        usage,
        label: `molgpu:${label}`,
      });
      trackOwnedBuffer(buffer, label);
      made.push(buffer);
      if (data?.byteLength) {
        device.queue.writeBuffer(buffer, 0, data as BufferSource);
        count("uploadBytes", label, data.byteLength);
      }
      return buffer;
    };
    const graphData = (data: ArrayBufferView, label: string) =>
      make(data.byteLength, STORAGE | COPY_DST, label, data);
    return {
      all: made,
      centered: layout.components.length,
      parent: graphData(forest.parent, "coords:unwrap:graph"),
      component: graphData(forest.component, "coords:unwrap:graph"),
      ringEdges: graphData(forest.ringEdges, "coords:unwrap:graph"),
      levelRows: graph.layered
        ? graphData(graph.levelRows, "coords:unwrap:graph")
        : null,
      levelRanges: graph.layered
        ? Array.from(
          { length: graph.levelStarts.length - 2 },
          (_, level) =>
            make(
              16,
              UNIFORM | COPY_DST,
              "coords:unwrap:levels",
              Uint32Array.of(
                graph.levelStarts[level + 1],
                graph.levelStarts[level + 2] - graph.levelStarts[level + 1],
                0,
                0,
              ),
            ),
        )
        : [],
      centerStarts: graphData(layout.starts, "coords:unwrap:center"),
      centerRows: graphData(layout.rows, "coords:unwrap:center"),
      centerComponents: graphData(layout.components, "coords:unwrap:center"),
      shifts: make(
        forest.roots.length * 16,
        STORAGE | COPY_DST,
        "coords:unwrap:shifts",
      ),
      links: Array.from(
        { length: graph.layered ? 1 : 2 },
        () => make(n * UNWRAP_LINK_BYTES, STORAGE, "coords:unwrap:links"),
      ),
      status: make(16, STORAGE | COPY_SRC | COPY_DST, "coords:unwrap:status"),
      params: make(
        UNWRAP_PARAMS_BYTES,
        UNIFORM | COPY_DST,
        "coords:unwrap:params",
      ),
    };
  }, [device, forest, graph, centerKey, n]);
  useResource((dispose) => {
    dispose(() => {
      for (const buffer of buffers.all) {
        releaseOwnedBuffer(buffer);
        buffer.destroy();
      }
    });
  }, [buffers]);
  const statusReadback = useStatusReadback(
    16,
    "coords:unwrap:staging",
    onStatus && ((data, generation) => {
      const [ambiguous, limited] = new Uint32Array(data);
      onStatus(Object.freeze({
        status: limited ? "search-limit" : ambiguous ? "ambiguous" : "ok",
        ambiguousRingEdges: ambiguous,
        generation,
      }));
    }),
  );

  const encode = (
    encoder: GPUCommandEncoder,
    input: GPUBuffer,
    output: GPUBuffer,
    generation: number,
  ) => {
    const pipes = unwrapPipelines(device);
    const params = new ArrayBuffer(UNWRAP_PARAMS_BYTES);
    const f = new Float32Array(params), u = new Uint32Array(params);
    const m = box.matrix, inv = box.inverse;
    for (let column = 0; column < 3; column++) {
      f.set(m.slice(3 * column, 3 * column + 3), 4 * column);
      // Row-major inverse to WGSL columns.
      f.set([inv[column], inv[3 + column], inv[6 + column]], 12 + 4 * column);
    }
    u.set(
      [n, forest.ringEdges.length / 2, MAX_CANDIDATES, buffers.centered],
      24,
    );
    f[28] = box.inverseNorm;
    device.queue.writeBuffer(buffers.params, 0, params);
    encoder.clearBuffer(buffers.status);
    encoder.clearBuffer(buffers.shifts);
    const group = (entry: Entry, bindings: [number, GPUBuffer][]) =>
      device.createBindGroup({
        layout: pipes[entry].getBindGroupLayout(0),
        entries: bindings.map(([binding, buffer]) => ({
          binding,
          resource: { buffer },
        })),
      });
    const rows = Math.ceil(n / GROUP);
    const pass = encoder.beginComputePass();
    const run = (
      entry: Entry,
      bindings: [number, GPUBuffer][],
      x: number,
      y = 1,
    ) => {
      pass.setPipeline(pipes[entry]);
      pass.setBindGroup(0, group(entry, bindings));
      pass.dispatchWorkgroups(x, y);
    };
    const [a, b] = buffers.links;
    run("link", [
      [0, input],
      [1, buffers.parent],
      [2, buffers.params],
      [4, a],
      [6, buffers.status],
    ], rows);
    let current = a, spare = b;
    if (graph.layered) {
      for (let level = 0; level < buffers.levelRanges.length; level++) {
        const count = graph.levelStarts[level + 2] -
          graph.levelStarts[level + 1];
        if (!count) continue;
        run("propagate", [
          [4, current],
          [13, buffers.levelRows!],
          [14, buffers.levelRanges[level]],
        ], Math.ceil(count / GROUP));
      }
    } else {
      for (let round = 0; round < graph.rounds; round++) {
        run("jump", [[2, buffers.params], [3, current], [4, spare]], rows);
        [current, spare] = [spare, current];
      }
    }
    if (buffers.centered) {
      run(
        "centerSums",
        [
          [0, input],
          [2, buffers.params],
          [3, current],
          [9, buffers.shifts],
          [10, buffers.centerStarts],
          [11, buffers.centerRows],
          [12, buffers.centerComponents],
        ],
        Math.min(buffers.centered, MAX_GROUPS),
        Math.ceil(buffers.centered / MAX_GROUPS),
      );
    }
    run("place", [
      [0, input],
      [2, buffers.params],
      [3, current],
      [7, output],
      [8, buffers.component],
      [9, buffers.shifts],
    ], rows);
    const ringCount = forest.ringEdges.length / 2;
    if (ringCount) {
      run("rings", [
        [0, input],
        [2, buffers.params],
        [3, current],
        [5, buffers.ringEdges],
        [6, buffers.status],
      ], Math.ceil(ringCount / GROUP));
    }
    pass.end();
    // Status is optional and never blocks a frame: with both staging buffers
    // mapped, this generation goes unreported.
    return statusReadback(encoder, buffers.status, generation);
  };
  return use(CoordinatePasses, {
    upstream,
    label: "coords:unwrap",
    parameterKey: `${graph.id}:${centerKey}:${box.matrix.join(",")}`,
    encode,
    children,
  });
};

const Centered: LC<{
  box: PeriodicBox;
  center: NonNullable<UnwrapProps["center"]>;
  onStatus?: (status: UnwrapStatus) => void;
  children: LiveElement;
}> = ({ box, center, onStatus, children }) => {
  const selection = useCoordinateSelection(center);
  if (selection && selection.domain !== "atom") {
    throw new TypeError("<Unwrap> center must be an atom query");
  }
  if (!selection) return children;
  return use(Unwrapped, {
    box,
    centerRows: selection.indices,
    centerKey: String(selection.id),
    onStatus,
    children,
  });
};

const Provider: LC<{
  box: UnwrapProps["box"];
  center: UnwrapProps["center"];
  onStatus?: (status: UnwrapStatus) => void;
  children: LiveElement;
}> = ({ box, center, onStatus, children }) => {
  const upstream = useCoordinates();
  const frame = useTrajectoryFrame();
  const raw = box === undefined ? frame?.box ?? null : box;
  let prepared: PeriodicBox | null = null;
  let failed: "missing-box" | "invalid-box" | null = null;
  if (!raw) failed = "missing-box";
  else {
    try {
      prepared = periodicBox(raw);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      failed = "invalid-box";
    }
  }
  const generation = upstream?.generation ?? 0;
  useResource(() => {
    if (failed) {
      onStatus?.(Object.freeze({
        status: failed,
        ambiguousRingEdges: 0,
        generation,
      }));
    }
  }, [failed, generation]);
  // Without a usable box, positions pass through unchanged.
  if (!upstream || !upstream.count || !prepared) return children;
  if (center) {
    return use(Centered, { box: prepared, center, onStatus, children });
  }
  return use(Unwrapped, {
    box: prepared,
    centerRows: null,
    centerKey: "none",
    onStatus,
    children,
  });
};

/**
 * Make each covalent component whole on the displayed periodic frame (a
 * coordinate provider, INVARIANT 6). Each component's atoms are placed by
 * exact nearest-image bond vectors from its root along a spanning forest of
 * the structure's covalent bonds, built once per topology. `box` defaults to
 * the nearest `<Trajectory>`'s displayed box; without a usable box, positions
 * pass through. `center` moves each component holding those atoms so their
 * centroid lies in the primary cell. `onStatus` reports ring edges that do
 * not close, and exhausted image searches. Put it below `<Trajectory>`:
 * it cannot repair a lerp across the box (use `pbc="minimum-image"`).
 */
export const Unwrap: ViewerComponent<UnwrapProps> = (
  { box, center, onStatus, children },
) => viewer(use(Provider, { box, center, onStatus, children: live(children) }));
