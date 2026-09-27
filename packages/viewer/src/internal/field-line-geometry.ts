// Pure pieces of <FieldLines>: the integrator WGSL, seed lattices and strip
// topology. No Live or GPU imports, so they run under plain `deno test`.
import { sampleVolumeGradientWgsl } from "@molgpu/fields";
import type { VolumeGrid } from "@molgpu/table";

export const FIELD_LINES_WORKGROUP = 64;

/**
 * Compute WGSL tracing each seed both ways along E/|E| with classic RK4 in
 * arc length. Invocation 2·line (+E) and 2·line + 1 (−E) fill the halves of
 * that line's `2·steps + 1` vertices. `w` holds |E| (per Å), or −1 once the
 * line has stopped: it left the grid, |E| fell below `minField`, or |φ|
 * exceeded `maxPotential` (it ran into a charge). Stopped vertices repeat the
 * last point and are drawn with zero width.
 */
export function fieldLinesWgsl(grid: VolumeGrid): string {
  return `
struct Params { lines: u32, steps: u32, _a: u32, _b: u32, h: f32, minField: f32, maxPotential: f32, _c: f32 };
@group(0) @binding(0) var<storage, read> phi: array<f32>;
@group(0) @binding(1) var<storage, read> seeds: array<f32>;
@group(0) @binding(2) var<storage, read_write> vertices: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: Params;
fn volumeValue(i: u32) -> f32 { return phi[i]; }
${sampleVolumeGradientWgsl(grid, "grad", "volumeValue")}
fn fieldAt(p: vec3<f32>) -> vec3<f32> { return -grad(p); }
fn usable(p: vec3<f32>, e: vec3<f32>) -> bool {
  return length(e) >= params.minField && abs(grad_sample(p)) <= params.maxPotential;
}
fn unit(e: vec3<f32>) -> vec3<f32> {
  let m = length(e);
  return select(vec3<f32>(0.0), e / m, m > 0.0);
}
@compute @workgroup_size(${FIELD_LINES_WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let t = id.x;
  if (t >= params.lines * 2u) { return; }
  let line = t / 2u;
  let forward = (t & 1u) == 0u;
  let steps = params.steps;
  let center = line * (2u * steps + 1u) + steps;
  var p = vec3<f32>(seeds[line * 3u], seeds[line * 3u + 1u], seeds[line * 3u + 2u]);
  var e = fieldAt(p);
  var alive = usable(p, e);
  if (forward) {
    vertices[center] = vec4<f32>(p, select(-1.0, length(e), alive));
  }
  let h = select(-params.h, params.h, forward);
  for (var s = 1u; s <= steps; s++) {
    if (alive) {
      let k1 = unit(e);
      let k2 = unit(fieldAt(p + 0.5 * h * k1));
      let k3 = unit(fieldAt(p + 0.5 * h * k2));
      let k4 = unit(fieldAt(p + h * k3));
      let q = p + (h / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
      let eq = fieldAt(q);
      if (usable(q, eq)) {
        p = q;
        e = eq;
      } else {
        alive = false;
      }
    }
    let v = select(center - s, center + s, forward);
    vertices[v] = vec4<f32>(p, select(-1.0, length(e), alive));
  }
}
`;
}

/** Seeds on a regular lattice through the grid, thinned to at most `max`. */
export function latticeSeeds(
  grid: VolumeGrid,
  spacing: number,
  max: number,
): Float32Array {
  const t = grid.transform;
  const axes = [0, 1, 2].map((a) =>
    Math.hypot(t[a * 4], t[a * 4 + 1], t[a * 4 + 2])
  );
  const ticks = [0, 1, 2].map((a) => {
    const top = grid.dims[a] - 1, step = spacing / axes[a];
    const out: number[] = [];
    for (let u = step / 2; u < top; u += step) out.push(u);
    return out.length ? out : [top / 2];
  });
  const total = ticks[0].length * ticks[1].length * ticks[2].length;
  // A deterministic stride keeps the default from throwing on large grids.
  const stride = Math.max(1, Math.ceil(total / max));
  const points: number[] = [];
  let n = 0;
  for (const w of ticks[2]) {
    for (const v of ticks[1]) {
      for (const u of ticks[0]) {
        if (n++ % stride) continue;
        points.push(
          t[0] * u + t[4] * v + t[8] * w + t[12],
          t[1] * u + t[5] * v + t[9] * w + t[13],
          t[2] * u + t[6] * v + t[10] * w + t[14],
        );
      }
    }
  }
  return Float32Array.from(points);
}

/** Per line: one strip of `2·steps + 1` vertices (1 start, 3 middle, 2 end). */
export function lineSegments(lines: number, steps: number): Int32Array {
  const span = 2 * steps + 1;
  const out = new Int32Array(lines * span);
  for (let l = 0; l < lines; l++) {
    out[l * span] = 1;
    out.fill(3, l * span + 1, (l + 1) * span - 1);
    out[(l + 1) * span - 1] = 2;
  }
  return out;
}
