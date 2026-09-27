/** One precomputed mode at residue-guide (normally CA) resolution. */
export interface NormalModeData {
  /** Owned xyz displacement per guide node, in node order. */
  readonly vectors: Float32Array;
  /** Atom row to guide node, or 0xffffffff for no displacement. */
  readonly atomToNode: Uint32Array;
  /** Increment when vectors or mapping are replaced. */
  readonly version: number;
}

/** Validate immutable structural mode inputs against an atom count. */
export function validateNormalMode(
  mode: NormalModeData,
  atomCount: number,
): void {
  if (
    !Number.isSafeInteger(mode.version) || mode.version < 0 ||
    !Number.isSafeInteger(atomCount) || atomCount < 0 ||
    mode.atomToNode.length !== atomCount || mode.vectors.length % 3 !== 0
  ) {
    throw new TypeError(
      "normal mode version, mapping or vector length is invalid",
    );
  }
  const nodes = mode.vectors.length / 3;
  for (const value of mode.vectors) {
    if (!Number.isFinite(value)) {
      throw new TypeError("normal mode vectors must be finite");
    }
  }
  for (const node of mode.atomToNode) {
    if (node !== 0xffffffff && node >= nodes) {
      throw new TypeError("normal mode atom mapping is out of range");
    }
  }
}

/** Add a sinusoidal mode to upstream packed xyz without changing the input. */
export function applyNormalMode(
  positions: Float32Array,
  mode: NormalModeData,
  amplitude: number,
  frequency: number,
  time: number,
  phase = 0,
): Float32Array {
  if (
    positions.length % 3 !== 0 ||
    [amplitude, frequency, time, phase].some((x) => !Number.isFinite(x))
  ) {
    throw new TypeError(
      "normal mode positions and scalar parameters must be finite",
    );
  }
  validateNormalMode(mode, positions.length / 3);
  for (const value of positions) {
    if (!Number.isFinite(value)) {
      throw new TypeError("normal mode positions must be finite");
    }
  }
  const out = positions.slice();
  const scale = amplitude * Math.sin(2 * Math.PI * frequency * time + phase);
  if (!Number.isFinite(scale)) {
    throw new RangeError("normal mode scale overflows");
  }
  if (scale === 0) return out;
  for (let row = 0; row < mode.atomToNode.length; row++) {
    const node = mode.atomToNode[row];
    if (node === 0xffffffff) continue;
    for (let axis = 0; axis < 3; axis++) {
      out[3 * row + axis] += scale * mode.vectors[3 * node + axis];
    }
  }
  return out;
}

/** Link order: size, scale uniform, atom-to-node and mode-vector storage,
 * upstream vec3 source, then packed xyz output. */
export const normalModeWgsl: string = `
@link fn getSize() -> vec2<u32>;
@link fn getScale() -> f32;
@link fn getNode(i: u32) -> u32;
@link fn getVector(i: u32) -> f32;
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  var p = getInput(i);
  let node = getNode(i);
  if (node != 0xffffffffu) {
    let offset = node * 3u;
    p += getScale() * vec3<f32>(
      getVector(offset), getVector(offset + 1u), getVector(offset + 2u));
  }
  output[i * 3u] = p.x;
  output[i * 3u + 1u] = p.y;
  output[i * 3u + 2u] = p.z;
}
`;
