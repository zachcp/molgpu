/** Bytes of the `Params` uniform that every `coulombWgsl` entry reads. */
export const COULOMB_PARAMS_BYTES = 112;
/** Invocations per workgroup, and atoms per shared-memory tile, in every entry. */
export const COULOMB_WORKGROUP = 64;
/** Consecutive grid samples each `sumGrid` invocation computes. */
export const COULOMB_GRID_BLOCK = 4;
/** Samples per `sumGridCutoff` workgroup brick along x, y and z. */
export const COULOMB_CUTOFF_BRICK: readonly [number, number, number] = Object
  .freeze([16, 4, 4]);

/**
 * WGSL for tiled direct Coulomb summation (see `coulombPotential` for the
 * physics), in three entry points of one module:
 *
 * 1. `packAtoms` (one invocation per summed atom): gathers `(x, y, z, q)` from the
 *    live packed-xyz positions and the per-row charge column through a row
 *    list into a vec4 buffer.
 * 2. `sumGrid` (one invocation per `COULOMB_GRID_BLOCK` consecutive grid
 *    samples, x-fastest, starting at sample `offset`): the potential of packed
 *    atoms `[atomStart, atomEnd)` at each sample's world position,
 *    `transform · (i, j, k, 1)`. Atoms stream through workgroup memory 64 at a
 *    time and each one read serves every sample of the block (register
 *    blocking); the potential model is chosen once per tile, not per pair. A caller bounds each dispatch's cost by splitting the grid into
 *    sample ranges (every range sums every atom, so no dispatch reads or
 *    rewrites another's output). With `accumulate` 1 the sum is added to the
 *    output instead of overwriting it.
 * 3. `sumPoints` (one invocation per point): the same sum at packed-xyz points,
 *    writing `vec4(φ, E)` with the closed-form field, over the same range and
 *    accumulate rule. It applies the cutoff switch when one is set.
 * 4. `sumGridCutoff` (one workgroup per `COULOMB_CUTOFF_BRICK` brick of grid
 *    samples, bricks x-fastest from brick `offset`, `counts.x` bricks): the
 *    switched sum with a cutoff. It reads the 64-atom tile boxes `tileBounds`
 *    computed from the live packed positions (binding 8) and sums only tiles
 *    within the cutoff of its brick, so spatially ordered atoms skip most
 *    tiles. `sumGrid` itself always sums exactly.
 * 5. `tileBounds` (one workgroup per 64-atom tile, `packAtoms` params): each
 *    tile's bounding box, as two vec4 per tile in `tileBoxes`.
 *
 * `counts.x` is the number of samples or points a dispatch writes; `sumGrid`
 * needs `ceil(counts.x / COULOMB_GRID_BLOCK)` invocations.
 * Invocation index is `id.x + id.y * params.config.y`, so a dispatch wider
 * than 65 535 workgroups folds into a 2D grid (`config.y` = groups in x × 64);
 * `sumGrid` and `sumPoints` add `config.w` to it.
 * Every invocation reaches the tile barriers; out-of-range ones only skip the
 * write.
 *
 * Bindings (group 0): 0 `positions` packed xyz f32; 1 `charges` f32 per
 * topology row; 2 `rows` u32 summed rows; 3 `packed` vec4 xyzq; 4 `params`
 * uniform; 5 `potential` f32 per grid sample; 6 `points` packed xyz f32; 7
 * `fields` vec4 per point; 8 `tileBoxes` vec4 pairs per tile. Each entry uses
 * only its own bindings.
 *
 * `Params` (112 bytes): `counts` = (invocations, atomStart, atomEnd,
 * accumulate); `config` = (model 0 vacuum / 1 distance / 2 debye, row width,
 * packCount, offset); `axis0..2` = index-to-world columns with w = (scale, kappa,
 * minDistance); `origin` = translation with w = cutoff (0: exact sum);
 * `dims` = (nx, ny, nz, bits of the f32 switchOn distance).
 */
export const coulombWgsl: string = `
struct Params {
  counts: vec4<u32>,
  config: vec4<u32>,
  axis0: vec4<f32>,
  axis1: vec4<f32>,
  axis2: vec4<f32>,
  origin: vec4<f32>,
  dims: vec4<u32>,
};
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> charges: array<f32>;
@group(0) @binding(2) var<storage, read> rows: array<u32>;
@group(0) @binding(3) var<storage, read_write> packed: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read_write> potential: array<f32>;
@group(0) @binding(6) var<storage, read> points: array<f32>;
@group(0) @binding(7) var<storage, read_write> fields: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> tileBoxes: array<vec4<f32>>;

const TILE = 64u;
var<workgroup> tile: array<vec4<f32>, 64>;
var<workgroup> tileLow: array<vec3<f32>, 64>;
var<workgroup> tileHigh: array<vec3<f32>, 64>;
var<workgroup> nearTiles: array<u32, 64>;
var<workgroup> nearCount: atomic<u32>;
var<workgroup> nearTotal: u32;

// Cutoff switch S(r) for squared distances u (CHARMM form, C1): 1 up to
// switchOn, 0 from the cutoff. Exact (1) when no cutoff is set.
fn switchOf(u: vec4<f32>) -> vec4<f32> {
  let c = params.origin.w;
  if (c <= 0.0) { return vec4<f32>(1.0); }
  let on = bitcast<f32>(params.dims.w);
  let c2 = c * c;
  let on2 = on * on;
  let d = c2 - on2;
  let s = (c2 - u) * (c2 - u) * (c2 + 2.0 * u - 3.0 * on2) / (d * d * d);
  return select(select(s, vec4<f32>(0.0), u >= vec4<f32>(c2)), vec4<f32>(1.0),
    u <= vec4<f32>(on2));
}

fn invocation(id: vec3<u32>) -> u32 {
  return id.x + id.y * params.config.y;
}

// (g, h): potential and -dphi/dr per unit charge at distance r, clamped.
fn kernel(r: f32) -> vec2<f32> {
  let rmin = params.axis2.w;
  let re = max(r, rmin);
  let inside = r < rmin;
  var g = 0.0;
  var h = 0.0;
  switch params.config.x {
    case 0u: {
      g = 1.0 / re;
      h = 1.0 / (re * re);
    }
    case 1u: {
      g = 1.0 / (re * re);
      h = 2.0 / (re * re * re);
    }
    default: {
      let e = exp(-params.axis1.w * re);
      g = e / re;
      h = e * (1.0 + params.axis1.w * re) / (re * re);
    }
  }
  h = select(h, 0.0, inside);
  let c = params.origin.w;
  if (c > 0.0) {
    // phi ~ g*S and E ~ h*S - g*S'.
    if (r >= c) { return vec2<f32>(0.0); }
    let on = bitcast<f32>(params.dims.w);
    if (r > on) {
      let c2 = c * c;
      let on2 = on * on;
      let u = r * r;
      let d3 = (c2 - on2) * (c2 - on2) * (c2 - on2);
      let s = (c2 - u) * (c2 - u) * (c2 + 2.0 * u - 3.0 * on2) / d3;
      let ds = 12.0 * r * (c2 - u) * (on2 - u) / d3;
      return vec2<f32>(g * s, h * s - g * ds);
    }
  }
  return vec2<f32>(g, h);
}

@compute @workgroup_size(64)
fn packAtoms(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = invocation(id);
  if (i >= params.config.z) { return; }
  let row = rows[i];
  packed[i] = vec4<f32>(
    positions[row * 3u],
    positions[row * 3u + 1u],
    positions[row * 3u + 2u],
    charges[row],
  );
}

// Sum phi (and E when wanted) at p over [atomStart, atomEnd). Every lane of
// the workgroup must call this, in step.
fn sumAt(p: vec3<f32>, lane: u32, wantField: bool) -> vec4<f32> {
  let start = params.counts.y;
  let end = params.counts.z;
  var total = vec4<f32>(0.0);
  for (var base = start; base < end; base += TILE) {
    let j = base + lane;
    var a = vec4<f32>(0.0);
    if (j < end) { a = packed[j]; }
    tile[lane] = a;
    workgroupBarrier();
    let n = min(TILE, end - base);
    var partial = vec4<f32>(0.0);
    for (var k = 0u; k < n; k++) {
      let atom = tile[k];
      let d = p - atom.xyz;
      let r = length(d);
      let gh = kernel(r);
      partial.x += atom.w * gh.x;
      if (wantField && r > 0.0) {
        partial = vec4<f32>(partial.x, partial.yzw + d * (atom.w * gh.y / r));
      }
    }
    total += partial;
    workgroupBarrier();
  }
  return total * params.axis0.w;
}

fn samplePosition(i: u32) -> vec3<f32> {
  let nx = params.dims.x;
  let ny = params.dims.y;
  let ijk = vec3<f32>(f32(i % nx), f32((i / nx) % ny), f32(i / (nx * ny)));
  return params.axis0.xyz * ijk.x + params.axis1.xyz * ijk.y +
    params.axis2.xyz * ijk.z + params.origin.xyz;
}

@compute @workgroup_size(64)
fn sumGrid(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(local_invocation_index) lane: u32,
) {
  let first = invocation(id) * 4u;
  let count = params.counts.x;
  let s0 = first + params.config.w;
  let p0 = samplePosition(s0);
  let p1 = samplePosition(s0 + 1u);
  let p2 = samplePosition(s0 + 2u);
  let p3 = samplePosition(s0 + 3u);
  let rmin = params.axis2.w;
  let floor2 = vec4<f32>(rmin * rmin);
  let kappa = params.axis1.w;
  let model = params.config.x;
  let start = params.counts.y;
  let end = params.counts.z;
  var total = vec4<f32>(0.0);
  for (var base = start; base < end; base += TILE) {
    let j = base + lane;
    var a = vec4<f32>(0.0);
    if (j < end) { a = packed[j]; }
    tile[lane] = a;
    workgroupBarrier();
    let n = min(TILE, end - base);
    // One uniform branch per tile; the pair loop carries no model switch.
    if (model == 0u) {
      for (var k = 0u; k < n; k++) {
        let atom = tile[k];
        total += atom.w * inverseSqrt(max(vec4<f32>(
          dot(p0 - atom.xyz, p0 - atom.xyz),
          dot(p1 - atom.xyz, p1 - atom.xyz),
          dot(p2 - atom.xyz, p2 - atom.xyz),
          dot(p3 - atom.xyz, p3 - atom.xyz),
        ), floor2));
      }
    } else if (model == 1u) {
      for (var k = 0u; k < n; k++) {
        let atom = tile[k];
        total += atom.w / max(vec4<f32>(
          dot(p0 - atom.xyz, p0 - atom.xyz),
          dot(p1 - atom.xyz, p1 - atom.xyz),
          dot(p2 - atom.xyz, p2 - atom.xyz),
          dot(p3 - atom.xyz, p3 - atom.xyz),
        ), floor2);
      }
    } else {
      for (var k = 0u; k < n; k++) {
        let atom = tile[k];
        let r = sqrt(max(vec4<f32>(
          dot(p0 - atom.xyz, p0 - atom.xyz),
          dot(p1 - atom.xyz, p1 - atom.xyz),
          dot(p2 - atom.xyz, p2 - atom.xyz),
          dot(p3 - atom.xyz, p3 - atom.xyz),
        ), floor2));
        total += atom.w * exp(-kappa * r) / r;
      }
    }
    workgroupBarrier();
  }
  let phi = total * params.axis0.w;
  for (var s = 0u; s < 4u; s++) {
    let local = first + s;
    if (local >= count) { return; }
    let i = local + params.config.w;
    if (params.counts.w != 0u) { potential[i] += phi[s]; } else { potential[i] = phi[s]; }
  }
}

// Bounding box of each 64-atom tile of the packed atoms (the packAtoms
// params: counts.x = atoms), written as two vec4 per tile.
@compute @workgroup_size(64)
fn tileBounds(
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
  @builtin(local_invocation_index) lane: u32,
) {
  let t = group.x + group.y * groups.x;
  let atoms = params.counts.x;
  let j = t * TILE + lane;
  var lo = vec3<f32>(3.0e38);
  var hi = vec3<f32>(-3.0e38);
  if (j < atoms) {
    lo = packed[j].xyz;
    hi = lo;
  }
  tileLow[lane] = lo;
  tileHigh[lane] = hi;
  workgroupBarrier();
  for (var step = 32u; step > 0u; step = step / 2u) {
    if (lane < step) {
      tileLow[lane] = min(tileLow[lane], tileLow[lane + step]);
      tileHigh[lane] = max(tileHigh[lane], tileHigh[lane + step]);
    }
    workgroupBarrier();
  }
  if (lane == 0u && t * TILE < atoms) {
    tileBoxes[t * 2u] = vec4<f32>(tileLow[0], 0.0);
    tileBoxes[t * 2u + 1u] = vec4<f32>(tileHigh[0], 0.0);
  }
}

fn gridPosition(ijk: vec3<u32>) -> vec3<f32> {
  let f = vec3<f32>(ijk);
  return params.axis0.xyz * f.x + params.axis1.xyz * f.y + params.axis2.xyz * f.z +
    params.origin.xyz;
}

@compute @workgroup_size(64)
fn sumGridCutoff(
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
  @builtin(local_invocation_index) lane: u32,
) {
  let dims = params.dims.xyz;
  let bricks = (dims + vec3<u32>(15u, 3u, 3u)) / vec3<u32>(16u, 4u, 4u);
  let local = group.x + group.y * groups.x;
  let validBrick = local < params.counts.x;
  let brick = local + params.config.w;
  let b0 = vec3<u32>(
    brick % bricks.x,
    (brick / bricks.x) % bricks.y,
    brick / (bricks.x * bricks.y),
  ) * vec3<u32>(16u, 4u, 4u);
  let s0 = b0 + vec3<u32>((lane % 4u) * 4u, (lane / 4u) % 4u, lane / 16u);
  let p0 = gridPosition(s0);
  let p1 = gridPosition(s0 + vec3<u32>(1u, 0u, 0u));
  let p2 = gridPosition(s0 + vec3<u32>(2u, 0u, 0u));
  let p3 = gridPosition(s0 + vec3<u32>(3u, 0u, 0u));
  // The brick's world box: the eight corners of its (clamped) index box.
  let top = min(b0 + vec3<u32>(15u, 3u, 3u), max(dims, vec3<u32>(1u)) - vec3<u32>(1u));
  var low = vec3<f32>(3.0e38);
  var high = vec3<f32>(-3.0e38);
  for (var corner = 0u; corner < 8u; corner++) {
    let q = gridPosition(select(b0, top, vec3<bool>(
      (corner & 1u) != 0u, (corner & 2u) != 0u, (corner & 4u) != 0u)));
    low = min(low, q);
    high = max(high, q);
  }
  let cutoff = params.origin.w;
  let cut2 = cutoff * cutoff;
  let floor2 = vec4<f32>(params.axis2.w * params.axis2.w);
  let kappa = params.axis1.w;
  let model = params.config.x;
  let start = params.counts.y;
  let end = params.counts.z;
  var total = vec4<f32>(0.0);
  let tiles = (end - start + TILE - 1u) / TILE;
  // Check 64 tile boxes at a time (one per lane), compact the ones within
  // the cutoff of this brick, then sum only those tiles.
  for (var t0 = 0u; t0 < tiles; t0 += TILE) {
    if (lane == 0u) { atomicStore(&nearCount, 0u); }
    workgroupBarrier();
    let t = t0 + lane;
    if (t < tiles) {
      let gap = max(
        max(tileBoxes[t * 2u].xyz - high, low - tileBoxes[t * 2u + 1u].xyz),
        vec3<f32>(0.0),
      );
      if (dot(gap, gap) < cut2) {
        nearTiles[atomicAdd(&nearCount, 1u)] = t;
      }
    }
    workgroupBarrier();
    if (lane == 0u) { nearTotal = atomicLoad(&nearCount); }
    let near = workgroupUniformLoad(&nearTotal);
    for (var k = 0u; k < near; k++) {
      let base = start + nearTiles[k] * TILE;
      let j = base + lane;
      var a = vec4<f32>(0.0);
      if (j < end) { a = packed[j]; }
      tile[lane] = a;
      workgroupBarrier();
      let n = min(TILE, end - base);
      var partial = vec4<f32>(0.0);
      for (var m = 0u; m < n; m++) {
        let atom = tile[m];
        let u = vec4<f32>(
          dot(p0 - atom.xyz, p0 - atom.xyz),
          dot(p1 - atom.xyz, p1 - atom.xyz),
          dot(p2 - atom.xyz, p2 - atom.xyz),
          dot(p3 - atom.xyz, p3 - atom.xyz),
        );
        let s = switchOf(u);
        let re2 = max(u, floor2);
        var g: vec4<f32>;
        if (model == 0u) {
          g = inverseSqrt(re2);
        } else if (model == 1u) {
          g = 1.0 / re2;
        } else {
          let re = sqrt(re2);
          g = exp(-kappa * re) / re;
        }
        partial += atom.w * g * s;
      }
      total += partial;
      workgroupBarrier();
    }
  }
  if (!validBrick) { return; }
  let phi = total * params.axis0.w;
  for (var s = 0u; s < 4u; s++) {
    let ijk = s0 + vec3<u32>(s, 0u, 0u);
    if (any(ijk >= dims)) { continue; }
    let i = ijk.x + dims.x * (ijk.y + dims.y * ijk.z);
    if (params.counts.w != 0u) { potential[i] += phi[s]; } else { potential[i] = phi[s]; }
  }
}

@compute @workgroup_size(64)
fn sumPoints(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(local_invocation_index) lane: u32,
) {
  let local = invocation(id);
  let valid = local < params.counts.x;
  let i = local + params.config.w;
  var p = vec3<f32>(0.0);
  if (valid) { p = vec3<f32>(points[i * 3u], points[i * 3u + 1u], points[i * 3u + 2u]); }
  let value = sumAt(p, lane, true);
  if (!valid) { return; }
  if (params.counts.w != 0u) { fields[i] += value; } else { fields[i] = value; }
}
`;

/** Model code in `Params.config.x`. */
export const COULOMB_MODEL_CODE: Readonly<Record<string, number>> = Object
  .freeze({ vacuum: 0, distance: 1, debye: 2 });

/** One dispatch's view of the `Params` uniform. */
export interface CoulombDispatch {
  /** Invocations that write: grid samples, points, or rows to pack. */
  readonly count: number;
  /** First grid sample or point this dispatch writes (default 0). */
  readonly offset?: number;
  /** Packed atom range summed by this dispatch. */
  readonly atomStart: number;
  readonly atomEnd: number;
  /** Add to the output instead of overwriting it. */
  readonly accumulate: boolean;
  /** Invocations per dispatch row (groups in x × 64). */
  readonly rowWidth: number;
  /** Grid dims and column-major index-to-world affine (`grid` only). */
  readonly dims?: readonly [number, number, number];
  readonly transform?: ArrayLike<number>;
}

/**
 * Encode the 112-byte `Params` uniform for one `coulombWgsl` dispatch from
 * normalised physics (`electrostatics(...)`).
 */
export function coulombParams(
  physics: {
    readonly model: string;
    readonly scale: number;
    readonly kappa: number;
    readonly minDistance: number;
    readonly cutoff?: number;
    readonly switchOn?: number;
  },
  dispatch: CoulombDispatch,
): ArrayBuffer {
  const model = COULOMB_MODEL_CODE[physics.model];
  if (model === undefined) {
    throw new TypeError(`coulombParams: unknown model ${physics.model}`);
  }
  const buffer = new ArrayBuffer(COULOMB_PARAMS_BYTES);
  const u = new Uint32Array(buffer), f = new Float32Array(buffer);
  u[0] = dispatch.count;
  u[1] = dispatch.atomStart;
  u[2] = dispatch.atomEnd;
  u[3] = dispatch.accumulate ? 1 : 0;
  u[4] = model;
  u[5] = dispatch.rowWidth;
  u[6] = dispatch.count;
  u[7] = dispatch.offset ?? 0;
  const t = dispatch.transform ??
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let c = 0; c < 4; c++) {
    f[8 + c * 4] = t[c * 4];
    f[9 + c * 4] = t[c * 4 + 1];
    f[10 + c * 4] = t[c * 4 + 2];
  }
  f[11] = physics.scale;
  f[15] = physics.kappa;
  f[19] = physics.minDistance;
  f[23] = physics.cutoff ?? 0;
  f[27] = physics.switchOn ?? 0;
  const dims = dispatch.dims ?? [1, 1, 1];
  u[24] = dims[0];
  u[25] = dims[1];
  u[26] = dims[2];
  return buffer;
}
