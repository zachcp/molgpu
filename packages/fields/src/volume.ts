// WGSL for sampling a VolumeData, shared by volumeSample's compiler and the
// viewer (slices). CPU parity: @molgpu/table's sampleVolume.
import {
  volumeGradientStep,
  type VolumeGrid,
  volumeInverseTransform,
} from "@molgpu/table";

import { f32Literal as f32 } from "./internal-numeric.ts";

/**
 * WGSL source for `fn <name>(p: vec3<f32>) -> f32`: a trilinear sample of a
 * scalar volume at world position `p`, reading samples through an accessor
 * `fn <read>(i: u32) -> f32` (x-fastest index) that the caller declares. The
 * volume's inverse affine and dims are baked in as constants. Points more than
 * 1e-4 cells outside the grid return 0; points on a face clamp to it.
 */
export function sampleVolumeWgsl(
  volume: VolumeGrid,
  name = "sampleVolume",
  read = "volumeValue",
): string {
  if (volume.components !== 1) {
    throw new TypeError(
      "sampleVolumeWgsl: expected a scalar volume; extract one with volumeComponent",
    );
  }
  const m = volumeInverseTransform(volume);
  const t = volume.transform;
  const [nx, ny, nz] = volume.dims;
  // Inverse linear part applied to (p - origin): fewer f32 cancellations than
  // the full inverse applied to p.
  const row = (r: number) => `${f32(m[r])}, ${f32(m[4 + r])}, ${f32(m[8 + r])}`;
  return `fn ${name}(p: vec3<f32>) -> f32 {
  let d = p - vec3<f32>(${f32(t[12])}, ${f32(t[13])}, ${f32(t[14])});
  let u = vec3<f32>(
    dot(vec3<f32>(${row(0)}), d),
    dot(vec3<f32>(${row(1)}), d),
    dot(vec3<f32>(${row(2)}), d),
  );
  let top = vec3<f32>(${f32(nx - 1)}, ${f32(ny - 1)}, ${f32(nz - 1)});
  if (any(u < vec3<f32>(-1e-4)) || any(u > top + vec3<f32>(1e-4))) { return 0.0; }
  let c = clamp(u, vec3<f32>(0.0), top);
  let b = min(floor(c), max(top - vec3<f32>(1.0), vec3<f32>(0.0)));
  let s = select(c - b, vec3<f32>(0.0), top == vec3<f32>(0.0));
  let i0 = vec3<u32>(b);
  let i1 = min(i0 + vec3<u32>(1u), vec3<u32>(top));
  let c000 = ${read}(i0.x + ${nx}u * (i0.y + ${ny}u * i0.z));
  let c100 = ${read}(i1.x + ${nx}u * (i0.y + ${ny}u * i0.z));
  let c010 = ${read}(i0.x + ${nx}u * (i1.y + ${ny}u * i0.z));
  let c110 = ${read}(i1.x + ${nx}u * (i1.y + ${ny}u * i0.z));
  let c001 = ${read}(i0.x + ${nx}u * (i0.y + ${ny}u * i1.z));
  let c101 = ${read}(i1.x + ${nx}u * (i0.y + ${ny}u * i1.z));
  let c011 = ${read}(i0.x + ${nx}u * (i1.y + ${ny}u * i1.z));
  let c111 = ${read}(i1.x + ${nx}u * (i1.y + ${ny}u * i1.z));
  let x00 = mix(c000, c100, s.x);
  let x10 = mix(c010, c110, s.x);
  let x01 = mix(c001, c101, s.x);
  let x11 = mix(c011, c111, s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z);
}`;
}

/**
 * WGSL source for `fn <name>(p: vec3<f32>) -> vec3<f32>`: the world-space
 * gradient (value per Å) of `sampleVolumeWgsl` by central differences along
 * world x, y and z with step `h` (default half the shortest grid axis), or
 * zero when any sample falls outside the grid. It declares its own sampler
 * `<name>_sample` over the same accessor. CPU parity: @molgpu/table's
 * `sampleVolumeGradient`.
 */
export function sampleVolumeGradientWgsl(
  volume: VolumeGrid,
  name = "sampleVolumeGradient",
  read = "volumeValue",
  h: number = volumeGradientStep(volume),
): string {
  const m = volumeInverseTransform(volume);
  const t = volume.transform;
  const [nx, ny, nz] = volume.dims;
  const row = (r: number) => `${f32(m[r])}, ${f32(m[4 + r])}, ${f32(m[8 + r])}`;
  return `${sampleVolumeWgsl(volume, `${name}_sample`, read)}
fn ${name}_inside(p: vec3<f32>) -> bool {
  let d = p - vec3<f32>(${f32(t[12])}, ${f32(t[13])}, ${f32(t[14])});
  let u = vec3<f32>(
    dot(vec3<f32>(${row(0)}), d),
    dot(vec3<f32>(${row(1)}), d),
    dot(vec3<f32>(${row(2)}), d),
  );
  let top = vec3<f32>(${f32(nx - 1)}, ${f32(ny - 1)}, ${f32(nz - 1)});
  return all(u >= vec3<f32>(-1e-4)) && all(u <= top + vec3<f32>(1e-4));
}
fn ${name}(p: vec3<f32>) -> vec3<f32> {
  let h = ${f32(h)};
  let dx = vec3<f32>(h, 0.0, 0.0);
  let dy = vec3<f32>(0.0, h, 0.0);
  let dz = vec3<f32>(0.0, 0.0, h);
  if (!(${name}_inside(p + dx) && ${name}_inside(p - dx) &&
      ${name}_inside(p + dy) && ${name}_inside(p - dy) &&
      ${name}_inside(p + dz) && ${name}_inside(p - dz))) {
    return vec3<f32>(0.0);
  }
  return vec3<f32>(
    ${name}_sample(p + dx) - ${name}_sample(p - dx),
    ${name}_sample(p + dy) - ${name}_sample(p - dy),
    ${name}_sample(p + dz) - ${name}_sample(p - dz),
  ) / (2.0 * h);
}`;
}
