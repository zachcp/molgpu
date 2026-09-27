/** Bytes of the `Params` uniform that every `coulombWgsl` entry reads. */
export const COULOMB_PARAMS_BYTES = 112;
/** Invocations per workgroup, and atoms per shared-memory tile, in every entry. */
export const COULOMB_WORKGROUP = 64;

/**
 * WGSL for tiled direct Coulomb summation (see `coulombPotential` for the
 * physics), in three entry points of one module:
 *
 * 1. `packAtoms` (one invocation per summed atom): gathers `(x, y, z, q)` from the
 *    live packed-xyz positions and the per-row charge column through a row
 *    list into a vec4 buffer.
 * 2. `sumGrid` (one invocation per grid sample, x-fastest, starting at sample
 *    `offset`): the potential of packed atoms `[atomStart, atomEnd)` at the
 *    sample's world position, `transform · (i, j, k, 1)`. Atoms stream through
 *    workgroup memory 64 at a time; each tile's partial sum joins the running
 *    total. A caller bounds each dispatch's cost by splitting the grid into
 *    sample ranges (every range sums every atom, so no dispatch reads or
 *    rewrites another's output). With `accumulate` 1 the sum is added to the
 *    output instead of overwriting it.
 * 3. `sumPoints` (one invocation per point): the same sum at packed-xyz points,
 *    writing `vec4(φ, E)` with the closed-form field, over the same range and
 *    accumulate rule.
 *
 * Invocation index is `id.x + id.y * params.config.y`, so a dispatch wider
 * than 65 535 workgroups folds into a 2D grid (`config.y` = groups in x × 64);
 * `sumGrid` and `sumPoints` add `config.w` to it.
 * Every invocation reaches the tile barriers; out-of-range ones only skip the
 * write.
 *
 * Bindings (group 0): 0 `positions` packed xyz f32; 1 `charges` f32 per
 * topology row; 2 `rows` u32 summed rows; 3 `packed` vec4 xyzq; 4 `params`
 * uniform; 5 `potential` f32 per grid sample; 6 `points` packed xyz f32; 7
 * `fields` vec4 per point. Each entry uses only its own bindings.
 *
 * `Params` (112 bytes): `counts` = (invocations, atomStart, atomEnd,
 * accumulate); `config` = (model 0 vacuum / 1 distance / 2 debye, row width,
 * packCount, offset); `axis0..2` = index-to-world columns with w = (scale, kappa,
 * minDistance); `origin` = translation; `dims` = (nx, ny, nz, 0).
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

const TILE = 64u;
var<workgroup> tile: array<vec4<f32>, 64>;

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
  return vec2<f32>(g, select(h, 0.0, inside));
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

@compute @workgroup_size(64)
fn sumGrid(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(local_invocation_index) lane: u32,
) {
  let local = invocation(id);
  let valid = local < params.counts.x;
  let i = local + params.config.w;
  let nx = params.dims.x;
  let ny = params.dims.y;
  let ijk = vec3<f32>(f32(i % nx), f32((i / nx) % ny), f32(i / (nx * ny)));
  let p = params.axis0.xyz * ijk.x + params.axis1.xyz * ijk.y +
    params.axis2.xyz * ijk.z + params.origin.xyz;
  let phi = sumAt(p, lane, false).x;
  if (!valid) { return; }
  if (params.counts.w != 0u) { potential[i] += phi; } else { potential[i] = phi; }
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
  const dims = dispatch.dims ?? [1, 1, 1];
  u[24] = dims[0];
  u[25] = dims[1];
  u[26] = dims[2];
  return buffer;
}
