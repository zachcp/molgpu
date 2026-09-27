/** A column-major 4x4 affine matrix in Ångström coordinates. */
export type AffineMatrix = ArrayLike<number>;

const EPSILON = 1e-6;

/** Reject perspective matrices and non-finite entries before CPU or GPU use. */
export function validateAffine(matrix: AffineMatrix): void {
  if (matrix.length !== 16) {
    throw new TypeError("affine matrix must have 16 column-major entries");
  }
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(matrix[i])) {
      throw new TypeError(`affine matrix[${i}] must be finite`);
    }
  }
  if (
    Math.abs(matrix[3]) > EPSILON ||
    Math.abs(matrix[7]) > EPSILON ||
    Math.abs(matrix[11]) > EPSILON ||
    Math.abs(matrix[15] - 1) > EPSILON
  ) {
    throw new TypeError("affine matrix must end in [0, 0, 0, 1]");
  }
}

/** True when a validated matrix leaves every xyz coordinate unchanged. */
export function isIdentityAffine(matrix: AffineMatrix): boolean {
  validateAffine(matrix);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return identity.every((v, i) => matrix[i] === v);
}

/** Apply an affine to packed xyz positions, optionally only to sorted atom rows. */
export function applyAffine(
  positions: Float32Array,
  matrix: AffineMatrix,
  rows?: ArrayLike<number> | null,
): Float32Array {
  validateAffine(matrix);
  if (positions.length % 3 !== 0) {
    throw new TypeError("positions must contain packed xyz triples");
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      throw new TypeError(`positions[${i}] must be finite`);
    }
  }
  const count = positions.length / 3;
  if (rows) {
    let previous = -1;
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k];
      if (!Number.isSafeInteger(row) || row <= previous || row >= count) {
        throw new TypeError(
          "rows must be sorted, unique atom indices in range",
        );
      }
      previous = row;
    }
  }
  const out = positions.slice();
  const apply = (row: number) => {
    const i = row * 3;
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    out[i + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    out[i + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  };
  if (rows) {
    for (let k = 0; k < rows.length; k++) apply(rows[k]);
  } else {
    for (let row = 0; row < count; row++) apply(row);
  }
  return out;
}

// Link order: size, four vec4 column uniforms, optional u32 bitset source,
// upstream vec3 source, packed f32 output. The viewer compiles these strings;
// no renderer type crosses this package boundary.
const HEAD = `
@link fn getSize() -> vec2<u32>;
@link fn getColumn0() -> vec4<f32>;
@link fn getColumn1() -> vec4<f32>;
@link fn getColumn2() -> vec4<f32>;
@link fn getColumn3() -> vec4<f32>;
`;
const BODY = `
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  let p = getInput(i);
  var q = p;
  TRANSFORM
  output[i * 3u] = q.x;
  output[i * 3u + 1u] = q.y;
  output[i * 3u + 2u] = q.z;
}
`;
const TRANSFORM = `let t = getColumn0() * p.x + getColumn1() * p.y +
    getColumn2() * p.z + getColumn3();
  q = t.xyz;`;

/** WGSL for applying an affine to every atom. */
export const affineWgsl: string = HEAD + BODY.replace("TRANSFORM", TRANSFORM);

/** WGSL for an affine selected by one bit per topology row. */
export const affineSelectedWgsl: string = HEAD +
  `@link fn getMask(word: u32) -> u32;\n` +
  BODY.replace(
    "TRANSFORM",
    `if ((getMask(i >> 5u) & (1u << (i & 31u))) != 0u) {
    ${TRANSFORM}
  }`,
  );
