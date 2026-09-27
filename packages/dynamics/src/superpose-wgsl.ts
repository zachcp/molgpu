/**
 * WGSL for a live Kabsch fit, in three entry points of one module that run in
 * order on the same upstream coordinates:
 *
 * 1. `centroid` (one workgroup): fit-row centroids of source and reference,
 *    each relative to its first fit row, so a large common offset does not
 *    swamp small shape differences in f32.
 * 2. `covariance` (one workgroup): centered cross-covariance and source
 *    scatter, then (lane 0) Horn's quaternion by 4×4 Jacobi rotations. A
 *    nearly collinear source frame (middle scatter eigenvalue below roughly
 *    1e-6 of the trace, tested through the scatter's 2×2 minors) writes no
 *    rotation, and the frame passes through unchanged.
 * 3. `apply` (one row per invocation): every output row moves,
 *    `R (p - cS) + target`, where the target is the reference centroid, or
 *    the source centroid when `translate` is 0.
 *
 * Bindings (group 0): 0 `positions` packed xyz f32 upstream; 1 `rows` u32 fit
 * rows (ignored unless `selected`); 2 `reference` packed xyz f32 of the fit
 * rows, in fit order; 3 `fit` a 144-byte read_write `Fit` state; 4 `params`
 * uniform `(fitCount, selected, translate, atomCount)`; 5 `output` packed xyz
 * f32. Reductions sum in a fixed order, so a fit is deterministic. The fit's
 * f32 rotation is accurate to about 1e-6, which the CPU `fitKabsch` oracle
 * checks in the viewer tests. `col0.w` marks solved vs passthrough and
 * `col1.w` holds fitted RMSD when solved for asynchronous status readback.
 */
export const superposeWgsl: string = `
struct Params { fitCount: u32, selected: u32, translate: u32, atomCount: u32 };
struct Fit {
  baseS: vec4<f32>,
  baseR: vec4<f32>,
  meanS: vec4<f32>,
  meanR: vec4<f32>,
  col0: vec4<f32>,
  col1: vec4<f32>,
  col2: vec4<f32>,
  targetBase: vec4<f32>,
  targetMean: vec4<f32>,
};
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> rows: array<u32>;
@group(0) @binding(2) var<storage, read> reference: array<f32>;
@group(0) @binding(3) var<storage, read_write> fit: Fit;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var<storage, read_write> output: array<f32>;

const LANES = 128u;
var<workgroup> pairSums: array<vec4<f32>, 256>;
var<workgroup> covSums: array<mat3x3<f32>, 128>;
var<workgroup> diagSums: array<vec4<f32>, 128>;
var<workgroup> offSums: array<vec4<f32>, 128>;

fn row(k: u32) -> u32 {
  if (params.selected != 0u) { return rows[k]; }
  return k;
}
fn sourceAt(k: u32) -> vec3<f32> {
  let i = row(k) * 3u;
  return vec3<f32>(positions[i], positions[i + 1u], positions[i + 2u]);
}
fn referenceAt(k: u32) -> vec3<f32> {
  let i = k * 3u;
  return vec3<f32>(reference[i], reference[i + 1u], reference[i + 2u]);
}

@compute @workgroup_size(128)
fn centroid(@builtin(local_invocation_index) lane: u32) {
  let bs = sourceAt(0u);
  let br = referenceAt(0u);
  var s = vec3<f32>(0.0);
  var r = vec3<f32>(0.0);
  for (var k = lane; k < params.fitCount; k += LANES) {
    s += sourceAt(k) - bs;
    r += referenceAt(k) - br;
  }
  pairSums[lane] = vec4<f32>(s, 0.0);
  pairSums[lane + LANES] = vec4<f32>(r, 0.0);
  workgroupBarrier();
  for (var stride = LANES / 2u; stride > 0u; stride /= 2u) {
    if (lane < stride) {
      pairSums[lane] += pairSums[lane + stride];
      pairSums[lane + LANES] += pairSums[lane + LANES + stride];
    }
    workgroupBarrier();
  }
  if (lane == 0u) {
    let n = f32(params.fitCount);
    fit.baseS = vec4<f32>(bs, 0.0);
    fit.baseR = vec4<f32>(br, 0.0);
    fit.meanS = vec4<f32>(pairSums[0].xyz / n, 0.0);
    fit.meanR = vec4<f32>(pairSums[LANES].xyz / n, 0.0);
  }
}

// Collinear test without eigenvectors: for a scatter matrix with eigenvalues
// l1 >= l2 >= l3 >= 0, the sum of its principal 2×2 minors c2 lies within a
// factor of 9 of l2 * trace, and needs no acos (which loses ~1e-4 relative
// precision near a repeated eigenvalue in f32).
fn nearlyCollinear(d: vec3<f32>, o: vec3<f32>) -> bool {
  let trace = d.x + d.y + d.z;
  let c2 = (d.x * d.y - o.x * o.x) + (d.x * d.z - o.y * o.y) +
    (d.y * d.z - o.z * o.z);
  return !(trace > 0.0) || c2 <= trace * trace * 1e-6;
}

@compute @workgroup_size(128)
fn covariance(@builtin(local_invocation_index) lane: u32) {
  var cov = mat3x3<f32>(vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
  var diag = vec3<f32>(0.0);
  var off = vec3<f32>(0.0);
  var refSquared = 0.0;
  for (var k = lane; k < params.fitCount; k += LANES) {
    let s = (sourceAt(k) - fit.baseS.xyz) - fit.meanS.xyz;
    let r = (referenceAt(k) - fit.baseR.xyz) - fit.meanR.xyz;
    // Column j holds s * r_j, so cov[j][i] = sum s_i r_j.
    cov += mat3x3<f32>(s * r.x, s * r.y, s * r.z);
    diag += s * s;
    off += vec3<f32>(s.x * s.y, s.x * s.z, s.y * s.z);
    refSquared += dot(r, r);
  }
  covSums[lane] = cov;
  diagSums[lane] = vec4<f32>(diag, refSquared);
  offSums[lane] = vec4<f32>(off, 0.0);
  workgroupBarrier();
  for (var stride = LANES / 2u; stride > 0u; stride /= 2u) {
    if (lane < stride) {
      covSums[lane] += covSums[lane + stride];
      diagSums[lane] += diagSums[lane + stride];
      offSums[lane] += offSums[lane + stride];
    }
    workgroupBarrier();
  }
  if (lane != 0u) { return; }
  let c = covSums[0];
  let d = diagSums[0].xyz;
  // A collinear source frame has no unique rotation: pass it through.
  if (nearlyCollinear(d, offSums[0].xyz)) {
    fit.col0 = vec4<f32>(1.0, 0.0, 0.0, 0.0);
    fit.col1 = vec4<f32>(0.0, 1.0, 0.0, -1.0);
    fit.col2 = vec4<f32>(0.0, 0.0, 1.0, 0.0);
    fit.targetBase = vec4<f32>(fit.baseS.xyz, 0.0);
    fit.targetMean = vec4<f32>(fit.meanS.xyz, 0.0);
    return;
  }
  let xx = c[0][0]; let xy = c[1][0]; let xz = c[2][0];
  let yx = c[0][1]; let yy = c[1][1]; let yz = c[2][1];
  let zx = c[0][2]; let zy = c[1][2]; let zz = c[2][2];
  var a = array<f32, 16>(
    xx + yy + zz, yz - zy, zx - xz, xy - yx,
    yz - zy, xx - yy - zz, xy + yx, zx + xz,
    zx - xz, xy + yx, -xx + yy - zz, yz + zy,
    xy - yx, zx + xz, yz + zy, -xx - yy + zz);
  var v = array<f32, 16>(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
  for (var sweep = 0; sweep < 12; sweep++) {
    for (var p = 0; p < 3; p++) {
      for (var q = p + 1; q < 4; q++) {
        let apq = a[p * 4 + q];
        let app = a[p * 4 + p];
        let aqq = a[q * 4 + q];
        if (abs(apq) <= 1e-12 * (abs(app) + abs(aqq)) || apq == 0.0) {
          continue;
        }
        let tau = (aqq - app) / (2.0 * apq);
        let t = select(1.0, -1.0, tau < 0.0) / (abs(tau) + sqrt(1.0 + tau * tau));
        let cs = 1.0 / sqrt(1.0 + t * t);
        let sn = t * cs;
        a[p * 4 + p] = app - t * apq;
        a[q * 4 + q] = aqq + t * apq;
        a[p * 4 + q] = 0.0;
        a[q * 4 + p] = 0.0;
        for (var k = 0; k < 4; k++) {
          if (k != p && k != q) {
            let akp = a[k * 4 + p];
            let akq = a[k * 4 + q];
            a[k * 4 + p] = cs * akp - sn * akq;
            a[p * 4 + k] = a[k * 4 + p];
            a[k * 4 + q] = sn * akp + cs * akq;
            a[q * 4 + k] = a[k * 4 + q];
          }
          let vkp = v[k * 4 + p];
          let vkq = v[k * 4 + q];
          v[k * 4 + p] = cs * vkp - sn * vkq;
          v[k * 4 + q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  var best = 0;
  for (var i = 1; i < 4; i++) {
    if (a[i * 4 + i] > a[best * 4 + best]) { best = i; }
  }
  var quat = normalize(vec4<f32>(v[best], v[4 + best], v[8 + best], v[12 + best]));
  if (quat.x < 0.0) { quat = -quat; }
  let w = quat.x; let x = quat.y; let y = quat.z; let z = quat.w;
  fit.col0 = vec4<f32>(1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + w * z),
    2.0 * (x * z - w * y), 1.0);
  fit.col1 = vec4<f32>(2.0 * (x * y - w * z), 1.0 - 2.0 * (x * x + z * z),
    2.0 * (y * z + w * x), 0.0);
  fit.col2 = vec4<f32>(2.0 * (x * z + w * y), 2.0 * (y * z - w * x),
    1.0 - 2.0 * (x * x + y * y), 0.0);
  // Centered fit error = |S|² + |R|² - 2 trace(R C). The fourth lane of
  // col1 is unused by apply and rides in the same small readback as the flag.
  let cross = dot(fit.col0.xyz, vec3<f32>(c[0][0], c[1][0], c[2][0])) +
    dot(fit.col1.xyz, vec3<f32>(c[0][1], c[1][1], c[2][1])) +
    dot(fit.col2.xyz, vec3<f32>(c[0][2], c[1][2], c[2][2]));
  fit.col1.w = sqrt(max(0.0,
    (d.x + d.y + d.z + diagSums[0].w - 2.0 * cross) /
    f32(params.fitCount)));
  if (params.translate != 0u) {
    fit.targetBase = vec4<f32>(fit.baseR.xyz, 0.0);
    fit.targetMean = vec4<f32>(fit.meanR.xyz, 0.0);
  } else {
    fit.targetBase = vec4<f32>(fit.baseS.xyz, 0.0);
    fit.targetMean = vec4<f32>(fit.meanS.xyz, 0.0);
  }
}

@compute @workgroup_size(64)
fn apply(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.atomCount) { return; }
  let p = vec3<f32>(positions[i * 3u], positions[i * 3u + 1u],
    positions[i * 3u + 2u]);
  var q = p;
  // col0.w flags a solved rotation; a collinear frame passes through exactly.
  if (fit.col0.w != 0.0) {
    let d = (p - fit.baseS.xyz) - fit.meanS.xyz;
    let rotation = mat3x3<f32>(fit.col0.xyz, fit.col1.xyz, fit.col2.xyz);
    q = (rotation * d + fit.targetMean.xyz) + fit.targetBase.xyz;
  }
  output[i * 3u] = q.x;
  output[i * 3u + 1u] = q.y;
  output[i * 3u + 2u] = q.z;
}
`;

/** Byte size of the `Fit` state buffer `superposeWgsl` reads and writes. */
export const SUPERPOSE_FIT_BYTES = 144;
