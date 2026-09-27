/**
 * In-test trajectory writers: DCD, XTC and TRR bytes from known coordinates,
 * so reader tests have an oracle that does not come from the reader under
 * test (docs/findings/2026-09-26-trajectory-plan.md, section 4).
 *
 * Provenance: the formats follow VMD's dcdplugin notes (DCD) and GROMACS's
 * xtcio/trrio/libxdrf sources as described in their documentation (XTC, TRR).
 * The XTC writer implements only what the decoder reads: the mixed-radix
 * integer packing and small-difference runs with a fixed run size (no
 * adaptive `smallidx`), so its output is valid but less compact than GROMACS's.
 * Coordinates come from the 2k39 NMR models in the BCIF corpus, which gives
 * the writers real protein geometry.
 */
import { structureFromBcif } from "../src/index.ts";
import { trajectoryFromModels } from "../../table/src/trajectory.ts";

class Bytes {
  #buffer = new ArrayBuffer(1024);
  #view = new DataView(this.#buffer);
  length = 0;
  constructor(readonly little = false) {}
  #grow(n: number) {
    if (this.length + n <= this.#buffer.byteLength) return;
    const next = new ArrayBuffer(
      Math.max(this.#buffer.byteLength * 2, this.length + n),
    );
    new Uint8Array(next).set(new Uint8Array(this.#buffer, 0, this.length));
    this.#buffer = next;
    this.#view = new DataView(next);
  }
  int(v: number) {
    this.#grow(4);
    this.#view.setInt32(this.length, v, this.little);
    this.length += 4;
  }
  float(v: number) {
    this.#grow(4);
    this.#view.setFloat32(this.length, v, this.little);
    this.length += 4;
  }
  double(v: number) {
    this.#grow(8);
    this.#view.setFloat64(this.length, v, this.little);
    this.length += 8;
  }
  bytes(b: ArrayLike<number>) {
    this.#grow(b.length);
    new Uint8Array(this.#buffer).set(b, this.length);
    this.length += b.length;
  }
  text(s: string, n = s.length) {
    this.bytes(
      Array.from({ length: n }, (_, i) => i < s.length ? s.charCodeAt(i) : 32),
    );
  }
  result(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.#buffer.slice(0, this.length));
  }
}

// ---------------------------------------------------------------- DCD

export interface DcdFixture {
  /** Å, x/y/z interleaved per atom. */
  frames: Float32Array[];
  /** The 6-double unit-cell record per frame, `(a, γ, b, β, α, c)`. */
  cells?: number[][];
  /** CHARMM header (float DELTA, optional cell record) or X-PLOR (double DELTA). */
  charmm?: boolean;
  little?: boolean;
  istart?: number;
  nsavc?: number;
  /** AKMA time units per integrator step. */
  delta?: number;
  /** Header NSET; defaults to the true frame count. */
  nset?: number;
  namnf?: number;
}

export function writeDcd(f: DcdFixture): Uint8Array<ArrayBuffer> {
  const charmm = f.charmm ?? true;
  const out = new Bytes(f.little ?? true);
  const atoms = f.frames[0].length / 3;
  out.int(84);
  out.text("CORD");
  const icntrl = new Array(20).fill(0);
  icntrl[0] = f.nset ?? f.frames.length;
  icntrl[1] = f.istart ?? 0;
  icntrl[2] = f.nsavc ?? 1;
  icntrl[8] = f.namnf ?? 0;
  if (charmm) {
    icntrl[10] = f.cells ? 1 : 0;
    icntrl[19] = 24;
  }
  for (let i = 0; i < 20; i++) {
    if (i === 9) {
      if (charmm) out.float(f.delta ?? 0);
      else {
        out.double(f.delta ?? 0);
        i++;
      }
    } else out.int(icntrl[i]);
  }
  out.int(84);
  const titles = [
    "* molgpu test trajectory",
    "* written by trajectory-fixture.ts",
  ];
  out.int(4 + 80 * titles.length);
  out.int(titles.length);
  for (const t of titles) out.text(t, 80);
  out.int(4 + 80 * titles.length);
  out.int(4);
  out.int(atoms);
  out.int(4);
  f.frames.forEach((positions, k) => {
    if (charmm && f.cells) {
      out.int(48);
      for (const v of f.cells[k]) out.double(v);
      out.int(48);
    }
    for (let axis = 0; axis < 3; axis++) {
      out.int(atoms * 4);
      for (let i = 0; i < atoms; i++) out.float(positions[i * 3 + axis]);
      out.int(atoms * 4);
    }
  });
  return out.result();
}

// ---------------------------------------------------------------- XTC

const MAGIC_INTS = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  8,
  10,
  12,
  16,
  20,
  25,
  32,
  40,
  50,
  64,
  80,
  101,
  128,
  161,
  203,
  256,
  322,
  406,
  512,
  645,
  812,
  1024,
  1290,
  1625,
  2048,
  2580,
  3250,
  4096,
  5060,
  6501,
  8192,
  10321,
  13003,
  16384,
  20642,
  26007,
  32768,
  41285,
  52015,
  65536,
  82570,
  104031,
  131072,
  165140,
  208063,
  262144,
  330280,
  416127,
  524287,
  660561,
  832255,
  1048576,
  1321122,
  1664510,
  2097152,
  2642245,
  3329021,
  4194304,
  5284491,
  6658042,
  8388607,
  10568983,
  13316085,
  16777216,
];

/** MSB-first bit stream, as libxdrf's sendbits writes it. */
class Bits {
  bytes: number[] = [];
  #byte = 0;
  #used = 0;
  write(count: number, value: number) {
    for (let i = count - 1; i >= 0; i--) {
      const bit = Math.floor(value / 2 ** i) % 2;
      this.#byte = (this.#byte << 1) | bit;
      if (++this.#used === 8) {
        this.bytes.push(this.#byte);
        this.#byte = 0;
        this.#used = 0;
      }
    }
  }
  finish(): number[] {
    if (this.#used) this.bytes.push(this.#byte << (8 - this.#used));
    this.#byte = this.#used = 0;
    return this.bytes;
  }
}

const sizeOfInt = (size: number) => {
  let bits = 0;
  for (let n = 1; size >= n && bits < 32; n *= 2) bits++;
  return bits;
};
/** Little-endian base-256 digits of the mixed-radix number nums over sizes. */
function mixedRadix(sizes: number[], nums: number[]): number[] {
  let digits: number[] = [];
  let tmp = nums[0];
  do {
    digits.push(tmp % 256);
    tmp = Math.floor(tmp / 256);
  } while (tmp !== 0);
  for (let i = 1; i < sizes.length; i++) {
    if (nums[i] < 0 || nums[i] >= sizes[i]) {
      throw new RangeError("xtc: value out of range");
    }
    let carry = nums[i];
    digits = digits.map((d) => {
      const t = d * sizes[i] + carry;
      carry = Math.floor(t / 256);
      return t % 256;
    });
    while (carry !== 0) {
      digits.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }
  return digits;
}
/** libxdrf's sizeofints: bits of the product of `sizes` (not product − 1).
 * The decoder recomputes it, so it must match exactly. */
const sizeOfInts = (sizes: number[]) => {
  let digits = [1];
  for (const s of sizes) {
    let carry = 0;
    digits = digits.map((d) => {
      const t = d * s + carry;
      carry = Math.floor(t / 256);
      return t % 256;
    });
    while (carry !== 0) {
      digits.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }
  return sizeOfInt(digits.at(-1)!) + (digits.length - 1) * 8;
};
function sendInts(bits: Bits, count: number, sizes: number[], nums: number[]) {
  const digits = mixedRadix(sizes, nums);
  if (count >= digits.length * 8) {
    for (const d of digits) bits.write(8, d);
    bits.write(count - digits.length * 8, 0);
  } else {
    for (let i = 0; i < digits.length - 1; i++) bits.write(8, digits[i]);
    bits.write(count - (digits.length - 1) * 8, digits.at(-1)!);
  }
}

export interface XtcFrame {
  /** Å, x/y/z interleaved per atom. */
  positions: Float32Array;
  /** Å, column-major box vectors. */
  box?: ArrayLike<number>;
  time?: number;
  step?: number;
}

/**
 * GROMACS XTC bytes. Coordinates are quantised to 1/precision nm the way
 * GROMACS does (round half away from zero). `smallIdx` fixes the
 * small-difference run size (default 27: ±0.255 nm at precision 1000).
 */
export function writeXtc(
  frames: XtcFrame[],
  options: { precision?: number; smallIdx?: number; maxRun?: number } = {},
): Uint8Array<ArrayBuffer> {
  const { precision = 1000, smallIdx = 27, maxRun = 8 } = options;
  const out = new Bytes(false);
  for (const [k, frame] of frames.entries()) {
    const n = frame.positions.length / 3;
    out.int(1995);
    out.int(n);
    out.int(frame.step ?? k);
    out.float(frame.time ?? k);
    for (let i = 0; i < 9; i++) out.float((frame.box?.[i] ?? 0) / 10);
    out.int(n);
    if (n <= 9) {
      for (let i = 0; i < n * 3; i++) out.float(frame.positions[i] / 10);
      continue;
    }
    const q = Int32Array.from(frame.positions, (v) => {
      const x = (v / 10) * precision;
      return x >= 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5);
    });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    q.forEach((v, i) => {
      min[i % 3] = Math.min(min[i % 3], v);
      max[i % 3] = Math.max(max[i % 3], v);
    });
    const size = [0, 1, 2].map((a) => max[a] - min[a] + 1);
    const large = size.some((s) => s > 0xffffff);
    const bitSizes = size.map(sizeOfInt);
    const bitSize = large ? 0 : sizeOfInts(size);
    const smallSize = MAGIC_INTS[smallIdx];
    const smallNum = Math.floor(smallSize / 2);
    const bits = new Bits();
    const at = (i: number) => [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]];
    const fits = (a: number[], b: number[]) =>
      a.every((v, axis) =>
        v - b[axis] + smallNum >= 0 && v - b[axis] + smallNum < smallSize
      );
    const writeLarge = (p: number[]) => {
      const v = p.map((x, a) => x - min[a]);
      if (large) v.forEach((x, a) => bits.write(bitSizes[a], x));
      else sendInts(bits, bitSize, size, v);
    };
    const writeSmall = (p: number[], ref: number[]) =>
      sendInts(
        bits,
        smallIdx,
        [smallSize, smallSize, smallSize],
        p.map((x, a) => x - ref[a] + smallNum),
      );
    let run = 0;
    for (let i = 0; i < n;) {
      // A run stores atom i relative to atom i + 1 (the decoder swaps them
      // back), then each following atom relative to the one before it.
      const small: number[][] = [];
      if (i + 1 < n && fits(at(i), at(i + 1))) {
        small.push(at(i));
        let previous = at(i);
        for (
          let j = i + 2;
          j < n && small.length < maxRun && fits(at(j), previous);
          j++
        ) {
          small.push(at(j));
          previous = at(j);
        }
      }
      writeLarge(small.length ? at(i + 1) : at(i));
      const wanted = small.length * 3;
      if (wanted === run) bits.write(1, 0);
      else {
        bits.write(1, 1);
        bits.write(5, wanted + 1); // is_smaller = 0 keeps smallIdx fixed
        run = wanted;
      }
      small.forEach((p, s) =>
        writeSmall(p, s === 0 ? at(i + 1) : small[s - 1])
      );
      i += small.length ? small.length + 1 : 1;
    }
    const payload = bits.finish();
    out.float(precision);
    for (const v of [...min, ...max]) out.int(v);
    out.int(smallIdx);
    out.int(payload.length);
    out.bytes(payload);
    out.bytes(new Array((4 - payload.length % 4) % 4).fill(0));
  }
  return out.result();
}

// ---------------------------------------------------------------- TRR

export interface TrrFrame {
  positions?: Float32Array;
  velocities?: Float32Array;
  forces?: Float32Array;
  box?: ArrayLike<number>;
  time?: number;
  step?: number;
  atoms?: number;
}

/** GROMACS TRR bytes; Å and Å/ps in, nm and nm/ps written. */
export function writeTrr(
  frames: TrrFrame[],
  options: { double?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const real = options.double ? 8 : 4;
  const out = new Bytes(false);
  const put = (v: number) => real === 8 ? out.double(v) : out.float(v);
  for (const [k, f] of frames.entries()) {
    const n = f.atoms ?? (f.positions ?? f.velocities ?? f.forces)!.length / 3;
    out.int(1993);
    out.int(13);
    out.int(12);
    out.text("GMX_trn_file");
    const sizes = [
      0,
      0,
      f.box ? 9 * real : 0,
      0,
      0,
      0,
      0,
      f.positions ? n * 3 * real : 0,
      f.velocities ? n * 3 * real : 0,
      f.forces ? n * 3 * real : 0,
    ];
    for (const s of sizes) out.int(s);
    out.int(n);
    out.int(f.step ?? k);
    out.int(0);
    put(f.time ?? k);
    put(0);
    for (const block of [f.box, f.positions, f.velocities, f.forces]) {
      if (block) { for (let i = 0; i < block.length; i++) put(block[i] / 10); }
    }
  }
  return out.result();
}

// ---------------------------------------------------------------- coordinates

let models: Promise<Float32Array[]> | undefined;

/** Model coordinates of the 2k39 NMR ensemble (116 × 1,231 atoms, Å). */
export function proteinFrames(): Promise<Float32Array[]> {
  models ??= (async () => {
    const bytes = await Deno.readFile(
      new URL("./fixtures/2k39.bcif", import.meta.url),
    );
    const trajectory = trajectoryFromModels(await structureFromBcif(bytes));
    return await Promise.all(
      Array.from(
        { length: trajectory.frameCount },
        (_, i) => trajectory.source.read(i).then((f) => f.positions),
      ),
    );
  })();
  return models;
}

/** `copies` of a frame on a grid `spacing` Å apart, for large-atom timing. */
export function tile(
  frame: Float32Array,
  copies: number,
  spacing = 45,
): Float32Array {
  const side = Math.ceil(Math.cbrt(copies));
  const out = new Float32Array(frame.length * copies);
  for (let c = 0; c < copies; c++) {
    const shift = [
      c % side,
      Math.floor(c / side) % side,
      Math.floor(c / side / side),
    ]
      .map((g) => g * spacing);
    for (let i = 0; i < frame.length; i++) {
      out[c * frame.length + i] = frame[i] + shift[i % 3];
    }
  }
  return out;
}
