// Synthetic CCP4/MRC maps for tests: the bytes encode `f(world)` at every
// sample, so a reader's affine can be checked against the function itself.

export interface Ccp4Fixture {
  /** Samples per file axis: columns, rows, sections. */
  readonly extent: readonly [number, number, number];
  /** Unit-cell sampling NX, NY, NZ. Default = extent in x/y/z order. */
  readonly grid?: readonly [number, number, number];
  /** Cell edge lengths a, b, c in Å. Default = grid (1 Å voxels). */
  readonly cell?: readonly [number, number, number];
  /** Cell angles α, β, γ in degrees. Default 90°. */
  readonly angles?: readonly [number, number, number];
  /** MAPC, MAPR, MAPS. Default [1, 2, 3]. */
  readonly axisOrder?: readonly [number, number, number];
  /** NCSTART, NRSTART, NSSTART. Default 0. */
  readonly start?: readonly [number, number, number];
  /** MRC2014 ORIGIN in Å (x, y, z). Default 0. Used by readers when nonzero. */
  readonly origin?: readonly [number, number, number];
  readonly mode?: 0 | 1 | 2 | 4;
  readonly littleEndian?: boolean;
  readonly f: (x: number, y: number, z: number) => number;
}

/** Column-major fractional-to-Cartesian matrix (a along x, b in the xy plane). */
export function fromFractional(
  [a, b, c]: readonly number[],
  [alpha, beta, gamma]: readonly number[],
): number[] {
  const rad = Math.PI / 180;
  const ca = Math.cos(alpha * rad),
    cb = Math.cos(beta * rad),
    cg = Math.cos(gamma * rad),
    sg = Math.sin(gamma * rad);
  const cy = (ca - cb * cg) / sg;
  const cz = Math.sqrt(1 - cb * cb - cy * cy);
  return [a, 0, 0, b * cg, b * sg, 0, c * cb, c * cy, c * cz];
}

/** World position of file sample (col, row, sec), per the CCP4/MRC convention. */
export function fixtureWorld(
  fixture: Ccp4Fixture,
  col: number,
  row: number,
  sec: number,
): [number, number, number] {
  const { extent, axisOrder = [1, 2, 3], start = [0, 0, 0] } = fixture;
  const byXyz = (v: readonly number[]) => {
    const out = [0, 0, 0];
    for (let n = 0; n < 3; n++) out[axisOrder[n] - 1] = v[n];
    return out;
  };
  const grid = fixture.grid ?? byXyz(extent);
  const cell = fixture.cell ?? grid;
  const origin = fixture.origin ?? [0, 0, 0];
  const g = byXyz([col, row, sec]);
  const hasOrigin = origin.some((v) => v !== 0);
  const offset = hasOrigin
    ? origin.map((o, n) => o / (cell[n] / grid[n]))
    : byXyz(start);
  const frac = g.map((v, n) => (v + offset[n]) / grid[n]);
  const m = fromFractional(cell, fixture.angles ?? [90, 90, 90]);
  return [
    m[0] * frac[0] + m[3] * frac[1] + m[6] * frac[2],
    m[1] * frac[0] + m[4] * frac[1] + m[7] * frac[2],
    m[2] * frac[0] + m[5] * frac[1] + m[8] * frac[2],
  ];
}

/** Encode a fixture as CCP4/MRC bytes. */
export function writeCcp4(fixture: Ccp4Fixture): Uint8Array {
  const {
    extent,
    angles = [90, 90, 90],
    axisOrder = [1, 2, 3],
    start = [0, 0, 0],
    origin = [0, 0, 0],
    mode = 2,
    littleEndian = true,
  } = fixture;
  const byXyz = (v: readonly number[]) => {
    const out = [0, 0, 0];
    for (let n = 0; n < 3; n++) out[axisOrder[n] - 1] = v[n];
    return out;
  };
  const grid = fixture.grid ?? byXyz(extent);
  const cell = fixture.cell ?? grid;
  const count = extent[0] * extent[1] * extent[2];
  const size = ({ 0: 1, 1: 2, 2: 4, 4: 8 } as const)[mode];
  const bytes = new Uint8Array(1024 + count * size);
  const view = new DataView(bytes.buffer);
  const int = (word: number, v: number) =>
    view.setInt32(word * 4, v, littleEndian);
  const float = (word: number, v: number) =>
    view.setFloat32(word * 4, v, littleEndian);
  extent.forEach((v, n) => int(n, v));
  int(3, mode);
  start.forEach((v, n) => int(4 + n, v));
  grid.forEach((v, n) => int(7 + n, v));
  cell.forEach((v, n) => float(10 + n, v));
  angles.forEach((v, n) => float(13 + n, v));
  axisOrder.forEach((v, n) => int(16 + n, v));
  int(22, 1); // ISPG
  origin.forEach((v, n) => float(49 + n, v));
  bytes.set([77, 65, 80, 32], 208); // "MAP "
  bytes.set(littleEndian ? [0x44, 0x41, 0, 0] : [0x11, 0x11, 0, 0], 212);
  let i = 0;
  for (let s = 0; s < extent[2]; s++) {
    for (let r = 0; r < extent[1]; r++) {
      for (let c = 0; c < extent[0]; c++, i++) {
        const v = fixture.f(...fixtureWorld(fixture, c, r, s));
        const at = 1024 + i * size;
        if (mode === 0) view.setInt8(at, Math.round(v));
        else if (mode === 1) view.setInt16(at, Math.round(v), littleEndian);
        else if (mode === 2) view.setFloat32(at, v, littleEndian);
        else view.setFloat32(at, v, littleEndian);
      }
    }
  }
  return bytes;
}
