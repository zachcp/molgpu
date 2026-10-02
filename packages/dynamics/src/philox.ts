// Philox-4x32-10 (Salmon et al., "Parallel random numbers: as easy as 1, 2,
// 3", SC 2011) and an inverse-CDF standard normal. The TypeScript and WGSL
// versions perform the same integer operations, so their u32 streams are
// bitwise equal; the 32x32->64 multiply is split into 16-bit halves because
// WGSL has no 64-bit integers.

const M0 = 0xd2511f53, M1 = 0xcd9e8d57;
const W0 = 0x9e3779b9, W1 = 0xbb67ae85;

/** High 32 bits of the 64-bit product of two u32 values. */
function mulhi(a: number, b: number): number {
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
  const mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  return (p11 + (p01 >>> 16) + (p10 >>> 16) + (mid >>> 16)) >>> 0;
}

/**
 * Philox-4x32-10 of a four-word counter under a two-word key. Returns four
 * u32 values; inputs are taken modulo 2^32.
 */
export function philox4x32(
  counter: ArrayLike<number>,
  key: ArrayLike<number>,
): Uint32Array {
  if (counter.length !== 4 || key.length !== 2) {
    throw new TypeError("philox needs a 4-word counter and a 2-word key");
  }
  let c0 = counter[0] >>> 0, c1 = counter[1] >>> 0;
  let c2 = counter[2] >>> 0, c3 = counter[3] >>> 0;
  let k0 = key[0] >>> 0, k1 = key[1] >>> 0;
  for (let round = 0; round < 10; round++) {
    if (round > 0) {
      k0 = (k0 + W0) >>> 0;
      k1 = (k1 + W1) >>> 0;
    }
    const hi0 = mulhi(M0, c0), lo0 = Math.imul(M0, c0) >>> 0;
    const hi1 = mulhi(M1, c2), lo1 = Math.imul(M1, c2) >>> 0;
    c0 = (hi1 ^ c1 ^ k0) >>> 0;
    c1 = lo1;
    c2 = (hi0 ^ c3 ^ k1) >>> 0;
    c3 = lo0;
  }
  return Uint32Array.of(c0, c1, c2, c3);
}

const f = Math.fround;

/**
 * Standard normal from one u32, in f32 arithmetic: u = (bits >> 9 + 0.5) /
 * 2^23 lies strictly inside (0, 1), and z = sqrt(2) erfinv(2u - 1) uses
 * Giles' single-precision erfinv ("Approximating the erfinv function", GPU
 * Computing Gems Jade, 2011) with 1 - x^2 formed as 4u(1 - u). It needs only
 * log, sqrt and polynomials, whose WGSL accuracy is tight, unlike the cos and
 * sin in Box-Muller.
 */
export function philoxNormal(bits: number): number {
  const u = f((((bits >>> 0) >>> 9) + 0.5) * 2 ** -23);
  const x = f(f(2 * u) - 1);
  let w = -f(Math.log(f(f(4 * u) * f(1 - u))));
  let p: number;
  if (w < 5) {
    w = f(w - 2.5);
    p = 2.81022636e-08;
    p = f(3.43273939e-07 + f(p * w));
    p = f(-3.5233877e-06 + f(p * w));
    p = f(-4.39150654e-06 + f(p * w));
    p = f(0.00021858087 + f(p * w));
    p = f(-0.00125372503 + f(p * w));
    p = f(-0.00417768164 + f(p * w));
    p = f(0.246640727 + f(p * w));
    p = f(1.50140941 + f(p * w));
  } else {
    w = f(f(Math.sqrt(w)) - 3);
    p = -0.000200214257;
    p = f(0.000100950558 + f(p * w));
    p = f(0.00134934322 + f(p * w));
    p = f(-0.00367342844 + f(p * w));
    p = f(0.00573950773 + f(p * w));
    p = f(-0.0076224613 + f(p * w));
    p = f(0.00943887047 + f(p * w));
    p = f(1.00167406 + f(p * w));
    p = f(2.83297682 + f(p * w));
  }
  return f(f(Math.SQRT2 * p) * x);
}

/**
 * The three standard normals the Langevin integrator draws for `node` at
 * `step`: Philox counter (node, 0, 0, 0) under key (seed, step), first three
 * words. The fourth word is discarded.
 */
export function langevinNormals(
  seed: number,
  step: number,
  node: number,
): [number, number, number] {
  const bits = philox4x32([node, 0, 0, 0], [seed, step]);
  return [philoxNormal(bits[0]), philoxNormal(bits[1]), philoxNormal(bits[2])];
}

/** WGSL twin of `philox4x32`, `philoxNormal` and `langevinNormals`. */
export const philoxWgsl: string = `
fn philoxMulhi(a: u32, b: u32) -> u32 {
  let a0 = a & 0xffffu; let a1 = a >> 16u;
  let b0 = b & 0xffffu; let b1 = b >> 16u;
  let p00 = a0 * b0; let p01 = a0 * b1; let p10 = a1 * b0; let p11 = a1 * b1;
  let mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  return p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u);
}

fn philox4x32(counter: vec4<u32>, key: vec2<u32>) -> vec4<u32> {
  var c = counter;
  var k = key;
  for (var round = 0u; round < 10u; round++) {
    if (round > 0u) {
      k = k + vec2<u32>(0x9e3779b9u, 0xbb67ae85u);
    }
    let hi0 = philoxMulhi(0xd2511f53u, c.x);
    let lo0 = 0xd2511f53u * c.x;
    let hi1 = philoxMulhi(0xcd9e8d57u, c.z);
    let lo1 = 0xcd9e8d57u * c.z;
    c = vec4<u32>(hi1 ^ c.y ^ k.x, lo1, hi0 ^ c.w ^ k.y, lo0);
  }
  return c;
}

fn philoxNormal(bits: u32) -> f32 {
  let u = (f32(bits >> 9u) + 0.5) * 1.1920928955078125e-7;
  let x = 2.0 * u - 1.0;
  var w = -log((4.0 * u) * (1.0 - u));
  var p: f32;
  if (w < 5.0) {
    w = w - 2.5;
    p = 2.81022636e-08;
    p = 3.43273939e-07 + p * w;
    p = -3.5233877e-06 + p * w;
    p = -4.39150654e-06 + p * w;
    p = 0.00021858087 + p * w;
    p = -0.00125372503 + p * w;
    p = -0.00417768164 + p * w;
    p = 0.246640727 + p * w;
    p = 1.50140941 + p * w;
  } else {
    w = sqrt(w) - 3.0;
    p = -0.000200214257;
    p = 0.000100950558 + p * w;
    p = 0.00134934322 + p * w;
    p = -0.00367342844 + p * w;
    p = 0.00573950773 + p * w;
    p = -0.0076224613 + p * w;
    p = 0.00943887047 + p * w;
    p = 1.00167406 + p * w;
    p = 2.83297682 + p * w;
  }
  return (1.4142135623730951 * p) * x;
}

fn langevinNormals(seed: u32, step: u32, node: u32) -> vec3<f32> {
  let bits = philox4x32(vec4<u32>(node, 0u, 0u, 0u), vec2<u32>(seed, step));
  return vec3<f32>(philoxNormal(bits.x), philoxNormal(bits.y), philoxNormal(bits.z));
}
`;
