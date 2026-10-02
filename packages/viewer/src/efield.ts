import { SelectionConsumer } from "./internal/selection-consumer.ts";
import type { Selection } from "@molgpu/select";
// <EField>: the electrostatic potential of the nearest coordinates and a charge
// column, summed directly on the GPU onto a locked grid and provided as a
// Volume (CONCEPT 9). See docs/findings/2026-09-27-efield-plan.md.
// Raw WebGPU, not use.gpu Kernel: one computation is split into dispatches
// bounded for the GPU watchdog, kept to one in flight with bursts coalesced,
// and published only after the queue reports it complete. Kernel dispatches
// once per frame in the frame's compute pass and reports neither (see
// docs/findings/2026-10-02-native-compute-audit.md).
import {
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
} from "@use-gpu/live";
import { LoopContext, useDeviceContext } from "@use-gpu/workbench";
import type { StorageSource } from "@use-gpu/core";
import { createVolume, type VolumeData, type VolumeGrid } from "@molgpu/table";
import {
  COULOMB_CUTOFF_BRICK,
  COULOMB_GRID_BLOCK,
  COULOMB_PARAMS_BYTES,
  COULOMB_WORKGROUP,
  coulombParams,
  coulombWgsl,
} from "@molgpu/dynamics/wgsl";
import { type Electrostatics, electrostatics } from "@molgpu/dynamics";
import { type Coordinates, useCoordinates } from "./coordinates-context.ts";
import { AttributesContext } from "./attributes-context.ts";
import {
  checkPairBudget,
  efieldChargeColumn,
  efieldGrid,
  rowBounds,
  spatialOrder,
} from "./internal/efield-grid.ts";
import { useAttributeSources } from "./internal/attribute-sources.ts";
import { checkAtomSelection } from "./internal/representation.ts";
import { viewRows } from "./internal/view-rows.ts";
import { ThrottledReadback } from "./internal/throttled-readback.ts";
import {
  type ReadbackToken,
  sameReadbackSource,
  sameReadbackToken,
} from "./internal/readback-token.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";

import {
  type NearestVolume,
  useStableGrid,
  VolumeContext,
} from "./volume-context.ts";
import type { EFieldProps, ViewerComponent } from "./types.ts";

const STORAGE = 0x0080;
const UNIFORM = 0x0040;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
/** Uniform offsets must be multiples of 256 bytes. */
const PARAMS_STRIDE = 256;
const MAX_GROUPS = 65535;
export const EFIELD_DEFAULT_SAMPLES = 128 ** 3;
/** Default ceiling on samples × summed atoms per computation (~1.7e10). */
export const EFIELD_DEFAULT_PAIRS = 2 ** 34;

/**
 * Test hooks, not public API: `pairsPerDispatch` bounds each dispatch's cost
 * (short enough for any GPU watchdog); `gate`, when set, delays completion so
 * a test can hold a computation in flight.
 */
export const efieldTesting: {
  pairsPerDispatch: number;
  gate: Promise<void> | null;
} = { pairsPerDispatch: 2 ** 30, gate: null };

type Pipelines = {
  pack: GPUComputePipeline;
  grid: GPUComputePipeline;
  cutoff: GPUComputePipeline;
  tiles: GPUComputePipeline;
};
const pipelineCache = new WeakMap<GPUDevice, Pipelines>();

function pipelines(device: GPUDevice): Pipelines {
  let cached = pipelineCache.get(device);
  if (!cached) {
    const module = device.createShaderModule({
      code: coulombWgsl,
      label: "molgpu:efield",
    });
    const make = (entryPoint: string) =>
      device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint },
        label: `molgpu:efield:${entryPoint}`,
      });
    cached = {
      pack: make("packAtoms"),
      grid: make("sumGrid"),
      cutoff: make("sumGridCutoff"),
      tiles: make("tileBounds"),
    };
    pipelineCache.set(device, cached);
  }
  return cached;
}

/**
 * Å cells of the Morton order a cutoff sums atoms in: small enough that a
 * 64-atom tile is compact at protein density, so whole tiles fall outside the
 * cutoff of most sample bricks.
 */
const ORDER_CELL = 2;

/** Workgroups for `count` invocations, folded into 2D past the 1D limit. */
function dispatchShape(invocations: number) {
  const groups = Math.max(1, Math.ceil(invocations / COULOMB_WORKGROUP));
  const x = Math.min(groups, MAX_GROUPS);
  return { x, y: Math.ceil(groups / x), rowWidth: x * COULOMB_WORKGROUP };
}

interface Request {
  maxHz: number;
  onPause: boolean;
}

const EFieldCompute: LC<{
  coordinates: Coordinates;
  grid: VolumeGrid;
  physics: Electrostatics;
  rows: Uint32Array;
  charges: StorageSource;
  range: number;
  maxHz: number | undefined;
  children: LiveElement;
}> = (
  { coordinates, grid, physics, rows, charges, range, maxHz, children },
) => {
  const device = useDeviceContext();
  const requestRepaint = useContext(LoopContext);
  const pipes = pipelines(device);
  const [nx, ny, nz] = grid.dims;
  const samples = nx * ny * nz;
  const atoms = rows.length;
  // Each dispatch covers a range of samples against every atom, so no
  // dispatch reads or rewrites another's output.
  // With a cutoff, a dispatch covers a range of sample bricks instead; its
  // pair bound counts every brick sample against every atom.
  const cutoff = physics.cutoff > 0;
  const [bx, by, bz] = COULOMB_CUTOFF_BRICK;
  const brickSamples = bx * by * bz;
  const units = cutoff
    ? Math.ceil(nx / bx) * Math.ceil(ny / by) * Math.ceil(nz / bz)
    : samples;
  const chunk = cutoff
    ? Math.max(
      1,
      Math.floor(
        efieldTesting.pairsPerDispatch / Math.max(1, atoms) / brickSamples,
      ),
    )
    : Math.max(
      COULOMB_WORKGROUP,
      Math.floor(
        efieldTesting.pairsPerDispatch / Math.max(1, atoms) /
          COULOMB_WORKGROUP,
      ) * COULOMB_WORKGROUP,
    );
  const chunks = Math.max(1, Math.ceil(units / chunk));

  const buffers = useMemo(() => {
    const made: GPUBuffer[] = [];
    const make = (size: number, usage: number, label: string) => {
      const buffer = device.createBuffer({
        size: Math.max(16, Math.ceil(size / 16) * 16),
        usage,
        label: `molgpu:${label}`,
      });
      trackOwnedBuffer(buffer, label);
      made.push(buffer);
      return buffer;
    };
    const rowBuffer = make(atoms * 4, STORAGE | COPY_DST, "efield:rows");
    if (atoms) {
      device.queue.writeBuffer(rowBuffer, 0, rows);
      count("uploadBytes", "efield:rows", rows.byteLength);
    }
    const packed = make(atoms * 16, STORAGE, "efield:packed");
    // Two vec4 per 64-atom tile: the cutoff pass's tile bounding boxes.
    const tileCount = Math.ceil(atoms / COULOMB_WORKGROUP);
    const tileBoxes = make(
      Math.max(1, tileCount) * 32,
      STORAGE,
      "efield:tile-boxes",
    );
    const tileShape = dispatchShape(tileCount * COULOMB_WORKGROUP);
    const phi = make(samples * 4, STORAGE | COPY_SRC | COPY_DST, "efield:phi");
    const params = make(
      (chunks + 1) * PARAMS_STRIDE,
      UNIFORM | COPY_DST,
      "efield:params",
    );
    const pack = dispatchShape(atoms);
    const shapes: ReturnType<typeof dispatchShape>[] = [];
    const bytes = new Uint8Array((chunks + 1) * PARAMS_STRIDE);
    bytes.set(
      new Uint8Array(coulombParams(physics, {
        count: atoms,
        atomStart: 0,
        atomEnd: 0,
        accumulate: false,
        rowWidth: pack.rowWidth,
      })),
      0,
    );
    for (let c = 0; c < chunks; c++) {
      const offset = c * chunk;
      const invocations = Math.min(chunk, units - offset);
      // Each sumGrid invocation writes COULOMB_GRID_BLOCK consecutive samples;
      // each sumGridCutoff workgroup writes one brick.
      const shape = dispatchShape(
        cutoff
          ? invocations * COULOMB_WORKGROUP
          : Math.ceil(invocations / COULOMB_GRID_BLOCK),
      );
      shapes.push(shape);
      bytes.set(
        new Uint8Array(coulombParams(physics, {
          count: invocations,
          offset,
          atomStart: 0,
          atomEnd: atoms,
          accumulate: false,
          rowWidth: shape.rowWidth,
          dims: grid.dims,
          transform: grid.transform,
        })),
        (c + 1) * PARAMS_STRIDE,
      );
    }
    device.queue.writeBuffer(params, 0, bytes);
    count("uploadBytes", "efield:params", bytes.byteLength);
    return {
      made,
      rowBuffer,
      packed,
      phi,
      params,
      pack,
      shapes,
      tileBoxes,
      tileShape,
    };
  }, [device, rows, grid, physics, chunk, chunks, units]);
  useResource((dispose) => {
    // A retained VolumeSlice or field shader may keep submitting this phi
    // allocation while replacement pipelines compile. Drop our ownership;
    // WebGPU reclaims it after the last retained binding becomes unreachable.
    dispose(() => buffers.made.forEach(releaseOwnedBuffer));
  }, [buffers]);

  const packGroup = useMemo(() =>
    atoms
      ? device.createBindGroup({
        layout: pipes.pack.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: coordinates.source.buffer } },
          { binding: 1, resource: { buffer: charges.buffer } },
          { binding: 2, resource: { buffer: buffers.rowBuffer } },
          { binding: 3, resource: { buffer: buffers.packed } },
          {
            binding: 4,
            resource: {
              buffer: buffers.params,
              offset: 0,
              size: COULOMB_PARAMS_BYTES,
            },
          },
        ],
      })
      : null, [buffers, coordinates.source.buffer, charges.buffer]);
  const tileGroup = useMemo(() =>
    atoms && cutoff
      ? device.createBindGroup({
        layout: pipes.tiles.getBindGroupLayout(0),
        entries: [
          { binding: 3, resource: { buffer: buffers.packed } },
          {
            binding: 4,
            resource: {
              buffer: buffers.params,
              offset: 0,
              size: COULOMB_PARAMS_BYTES,
            },
          },
          { binding: 8, resource: { buffer: buffers.tileBoxes } },
        ],
      })
      : null, [buffers, cutoff]);
  const gridGroups = useMemo(
    () =>
      Array.from({ length: chunks }, (_, c) =>
        device.createBindGroup({
          layout: (cutoff ? pipes.cutoff : pipes.grid).getBindGroupLayout(0),
          entries: [
            { binding: 3, resource: { buffer: buffers.packed } },
            {
              binding: 4,
              resource: {
                buffer: buffers.params,
                offset: (c + 1) * PARAMS_STRIDE,
                size: COULOMB_PARAMS_BYTES,
              },
            },
            { binding: 5, resource: { buffer: buffers.phi } },
            ...(cutoff
              ? [{ binding: 8, resource: { buffer: buffers.tileBoxes } }]
              : []),
          ],
        })),
    [buffers],
  );

  // Coalesced, latest-wins: one computation in flight. Inputs that change
  // meanwhile mark it pending; completion (a queue fence, not a readback)
  // wakes a render that computes the newest inputs. `maxHz` spaces
  // computations further.
  const alive = useRef(true);
  useResource((dispose) => {
    alive.current = true;
    dispose(() => {
      alive.current = false;
    });
  }, []);
  const flight = useRef({ busy: false, pending: false, last: -Infinity });
  const [wake, setWake] = useState(0);
  const next = useRef(0);
  const current = useRef(0);
  const generation = useMemo(() => {
    // A kernel-produced upstream holds zeros until its first dispatch; its
    // ready generation re-runs this memo.
    if (coordinates.ready === false) return current.current;
    const state = flight.current;
    if (state.busy) {
      state.pending = true;
      return current.current;
    }
    const wait = maxHz ? 1000 / maxHz - (performance.now() - state.last) : 0;
    if (wait > 0 && current.current) {
      state.pending = true;
      setTimeout(() => {
        if (alive.current && state.pending) {
          state.pending = false;
          setWake((w) => w + 1);
        }
      }, wait);
      return current.current;
    }
    const encoder = device.createCommandEncoder({ label: "molgpu:efield" });
    const pass = encoder.beginComputePass({ label: "molgpu:efield" });
    if (packGroup) {
      pass.setPipeline(pipes.pack);
      pass.setBindGroup(0, packGroup);
      pass.dispatchWorkgroups(buffers.pack.x, buffers.pack.y);
    }
    if (tileGroup) {
      pass.setPipeline(pipes.tiles);
      pass.setBindGroup(0, tileGroup);
      pass.dispatchWorkgroups(buffers.tileShape.x, buffers.tileShape.y);
    }
    pass.setPipeline(cutoff ? pipes.cutoff : pipes.grid);
    gridGroups.forEach((group, c) => {
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(buffers.shapes[c].x, buffers.shapes[c].y);
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    count("gathers", "efield:dispatch");
    state.busy = true;
    state.pending = false;
    state.last = performance.now();
    current.current = ++next.current;
    Promise.all([device.queue.onSubmittedWorkDone(), efieldTesting.gate])
      .then(() => {
        state.busy = false;
        if (alive.current && state.pending) {
          state.pending = false;
          setWake((w) => w + 1);
        }
      });
    return current.current;
  }, [
    coordinates.generation,
    coordinates.ready,
    coordinates.source.buffer,
    charges,
    packGroup,
    tileGroup,
    gridGroups,
    wake,
  ]);
  useResource(() => {
    requestRepaint();
  }, [generation]);

  const source = useMemo<StorageSource>(() => ({
    buffer: buffers.phi,
    format: "f32",
    length: samples,
    size: [samples],
    version: generation,
  }), [buffers.phi, samples, generation]);

  // CPU snapshots, only while a consumer (e.g. <Isosurface>) asks.
  const [requests, setRequests] = useState<Map<number, Request>>(new Map());
  const nextRequest = useRef(0);
  const subscribe = useMemo(() => (hz: number, onPause: boolean) => {
    const id = ++nextRequest.current;
    setRequests((previous) =>
      new Map(previous).set(id, { maxHz: hz, onPause })
    );
    return () =>
      setRequests((previous) => {
        const map = new Map(previous);
        map.delete(id);
        return map;
      });
  }, []);
  const [published, setPublished] = useState<
    { token: ReadbackToken; volume: VolumeData } | null
  >(null);
  const token: ReadbackToken = {
    owner: coordinates.resource,
    buffer: buffers.phi,
    bytes: samples * 4,
    layout: grid,
    generation,
  };
  const latest = useRef(token);
  latest.current = token;
  const publish = (values: Float32Array, copied: ReadbackToken): boolean => {
    if (!sameReadbackToken(latest.current, copied)) return false;
    setPublished({
      token: copied,
      volume: createVolume({
        values,
        dims: grid.dims,
        transform: grid.transform,
        ...(grid.unit === undefined ? {} : { unit: grid.unit }),
      }, { maxSamples: Infinity }),
    });
    return true;
  };
  const snapshot = published && sameReadbackSource(published.token, token)
    ? published.volume
    : null;
  const demand = [...requests.values()];

  const value = useMemo<NearestVolume>(() =>
    Object.freeze({
      grid,
      source,
      generation,
      range: Object.freeze([-range, range]) as [number, number],
      volume: null,
      snapshot,
      subscribe,
    }), [grid, source, generation, range, snapshot, subscribe]);
  if (!generation) return null;
  return provide(VolumeContext, value, [
    demand.length
      ? use(ThrottledReadback, {
        token,
        maxHz: Math.max(...demand.map((r) => r.maxHz)),
        onPause: demand.some((r) => r.onPause),
        label: "efield:snapshot",
        publish,
      })
      : null,
    children,
  ]);
};

const positive = (value: number, name: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`<EField> ${name} must be positive and finite`);
  }
};

/**
 * The electrostatic potential of the nearest coordinates, as a Volume for
 * the representations below it (`<Isosurface>`, `<VolumeSlice>`,
 * `volumeSample()`, `<FieldLines>`, `<FieldArrows>`).
 *
 * Charges come from the `charge` column (default `partialCharge`; assign one
 * with `templateCharges`, `applyPqr` or `structureFromPqr`, then
 * `withAttributes`). `select`'s atoms, else the first model's
 * primary-conformer atoms, are summed exactly on the GPU, tiled through
 * workgroup memory, with the dielectric model from `electrostatics()` in @molgpu/dynamics. The output is
 * φ in kT/e (or kcal/mol/e) on an axis-aligned grid: the summed atoms' bounds
 * at the first coordinates available, padded, `spacing` apart, or `box`. The
 * grid then stays fixed while coordinates move, so samplers never recompile;
 * it changes with the selected charged rows, `spacing`, `padding`, `box`,
 * the charge column or the topology.
 *
 * Each coordinate generation (a trajectory frame, a coordinate provider's
 * output) or charge change recomputes on the GPU with no CPU round trip. At
 * most one computation is in flight; frames that arrive meanwhile collapse
 * into the newest. CPU consumers read throttled snapshots instead
 * (`useVolumeSnapshot`). This is a Coulomb sum, not Poisson–Boltzmann: import
 * an APBS map with `<Volume>` when a solver's answer is needed.
 */
export const EField: ViewerComponent<EFieldProps> = (props) =>
  use(SelectionConsumer, {
    input: props.select,
    who: "EField",
    onSelectionStatus: props.onSelectionStatus,
    warnEmptySelection: props.warnEmptySelection,
    render: (select: Selection) => use(EFieldResolved, { ...props, select }),
  });

const EFieldResolved: LC<Omit<EFieldProps, "select"> & { select: Selection }> =
  (props) => {
    const coordinates = useCoordinates();
    if (!coordinates) return null;
    return (use(EFieldInner, { ...props, coordinates }));
  };

const EFieldInner: LC<
  Omit<EFieldProps, "select"> & { select: Selection; coordinates: Coordinates }
> = (
  {
    coordinates,
    children,
    select = null,
    charge = "partialCharge",
    model,
    epsilon,
    ionicStrength,
    temperature,
    minDistance,
    unit,
    cutoff,
    switchWidth,
    spacing = 1,
    padding = 8,
    box,
    maxSamples = EFIELD_DEFAULT_SAMPLES,
    maxPairs = EFIELD_DEFAULT_PAIRS,
    range,
    maxHz,
  },
) => {
  const { resource } = coordinates;
  checkAtomSelection(select, resource, "EField");
  positive(spacing, "spacing");
  positive(maxSamples, "maxSamples");
  positive(maxPairs, "maxPairs");
  if (range !== undefined) positive(range, "range");
  if (!Number.isFinite(padding) || padding < 0) {
    throw new TypeError("<EField> padding must be finite and non-negative");
  }
  if (maxHz !== undefined) positive(maxHz, "maxHz");
  if (
    box &&
    (![0, 1, 2].every((a) =>
      Number.isFinite(box.min[a]) && Number.isFinite(box.max[a]) &&
      box.max[a] >= box.min[a]
    ))
  ) {
    throw new TypeError("<EField> box needs finite min ≤ max on every axis");
  }
  const physics = useMemo(
    () =>
      electrostatics({
        model,
        epsilon,
        ionicStrength,
        temperature,
        minDistance,
        unit,
        ...(cutoff === undefined ? {} : { cutoff }),
        ...(switchWidth === undefined ? {} : { switchWidth }),
      }),
    [
      model,
      epsilon,
      ionicStrength,
      temperature,
      minDistance,
      unit,
      cutoff,
      switchWidth,
    ],
  );
  const produced = useContext(AttributesContext)?.[charge];
  const column = efieldChargeColumn(resource.data, charge, produced);
  const { active, rows } = useMemo(() => {
    const active = viewRows(resource.data, select);
    if (!column) return { active, rows: active };
    const q = column.values;
    return { active, rows: active.filter((row) => q[row] !== 0) };
  }, [resource.identity, resource.topologyRevision, select?.id, column]);
  // A cutoff skips atom tiles far from each sample brick, which pays only when
  // a tile's atoms are close together. Order rows by the structure's own
  // positions (a locality hint only: tile bounds are taken from the live
  // coordinates each pass, so motion costs speed, never correctness).
  const summed = useMemo(
    () =>
      physics.cutoff > 0
        ? spatialOrder(resource.data.positions, rows, ORDER_CELL)
        : rows,
    [rows, physics.cutoff > 0, resource.identity],
  );
  const { sources } = useAttributeSources(resource.data, [charge]);
  const charges = sources[`attr:${charge}`] as StorageSource;

  // The grid is placed around the structure's own positions of charged rows
  // (or all active rows when a GPU producer has no CPU charge values), or
  // `box`. Padding absorbs provider motion; pass `box` for large moves.
  const boxKey = box ? `${box.min.join()}:${box.max.join()}` : "";
  const grid = useMemo(() => {
    const bounds = box ?? rowBounds(
      resource.data.positions,
      column && rows.length ? rows : active,
    );
    if (!bounds) {
      throw new TypeError("<EField> has no atoms to place its grid around");
    }
    // An explicit box is the grid's extent; padding applies to atom bounds.
    return efieldGrid(
      bounds,
      spacing,
      box ? 0 : padding,
      physics.unit,
      maxSamples,
    );
  }, [
    resource.identity,
    resource.topologyRevision,
    active,
    rows,
    spacing,
    padding,
    boxKey,
    maxSamples,
    physics.unit,
  ]);
  checkPairBudget(grid, rows.length, maxPairs);
  const stable = useStableGrid(grid);
  // Screened potentials are an order of magnitude weaker.
  const display = range ??
    (physics.model === "debye" ? 2 : 15) *
      (physics.unit === "kT/e" ? 1 : physics.kT);
  if (produced?.ready === false) return null;
  return use(EFieldCompute, {
    coordinates,
    grid: stable,
    physics,
    rows: summed,
    charges,
    range: display,
    maxHz,
    children: children,
  });
};
