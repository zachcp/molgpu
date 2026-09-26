import { assert, assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { buildTubeGeometry } from '../src/internal/tube-geometry.ts';

/** A trace with: a 4-point run, a 1-point run (undrawable), and a 2-point run. */
function trace() {
  return {
    guide: Float32Array.from([
      0,0,0, 1,0,0, 2,1,0, 3,1,0,   // run 0: residues 0..3
      10,0,0,                        // run 1: residue 4 (isolated)
      20,0,0, 21,0,0,                // run 2: residues 5..6
    ]),
    residue: Uint32Array.from([0,1,2,3, 4, 5,6]),
    runs: Uint32Array.from([0, 4, 5, 7]),
  };
}

function assertFinite(arr: Iterable<number>) { for (const v of arr) assert(Number.isFinite(v)); }

Deno.test('drops single-residue runs (no direction to extrude) and keeps the rest as separate strips', () => {
  const geo = buildTubeGeometry(trace(), 4);
  // run0: 3 segments * 4 + 1 = 13 samples; run2: 1 segment * 4 + 1 = 5 samples.
  assertStrictEquals(geo.count, 13 + 5);
  assertFinite(geo.positions);
});

Deno.test('segment codes never bridge one run into the next', () => {
  const geo = buildTubeGeometry(trace(), 4);
  // First run's samples: 1, 3x11, 2. Second run's samples restart at 1, not 3.
  assertStrictEquals(geo.segments[0], 1);
  assertStrictEquals(geo.segments[12], 2);
  assertStrictEquals(geo.segments[13], 1, 'a new run must restart at code 1, never continue as 3');
  assertStrictEquals(geo.segments[geo.segments.length - 1], 2);
  for (let i = 1; i < 12; i++) assertStrictEquals(geo.segments[i], 3);
});

Deno.test('preserves a sample-to-residue mapping across subdivision', () => {
  const geo = buildTubeGeometry(trace(), 4);
  assertStrictEquals(geo.residue[0], 0); // run0 start = residue 0
  assertStrictEquals(geo.residue[12], 3); // run0 end = residue 3
  assertStrictEquals(geo.residue[13], 5); // run2 start = residue 5
  assertStrictEquals(geo.residue[geo.residue.length - 1], 6); // run2 end = residue 6
});

Deno.test('endpoints land exactly on the source guide points (Catmull-Rom interpolates, never overshoots the ends)', () => {
  const geo = buildTubeGeometry(trace(), 4);
  assertEquals([...geo.positions.slice(0, 3)], [0, 0, 0]);
  assertEquals([...geo.positions.slice(12 * 3, 12 * 3 + 3)], [3, 1, 0]);
});

Deno.test('an empty trace (every run undrawable, or no runs) produces zero geometry', () => {
  const onlySingles = { guide: Float32Array.from([0,0,0, 5,5,5]), residue: Uint32Array.from([0,1]), runs: Uint32Array.from([0,1,2]) };
  const geo = buildTubeGeometry(onlySingles, 6);
  assertStrictEquals(geo.count, 0);
  assertStrictEquals(geo.positions.length, 0);

  const empty = { guide: new Float32Array(), residue: new Uint32Array(), runs: Uint32Array.from([0]) };
  assertStrictEquals(buildTubeGeometry(empty, 6).count, 0);
});

Deno.test('rejects a non-positive-integer perSegment', () => {
  assertThrows(() => buildTubeGeometry(trace(), 0), Error, 'positive integer');
  assertThrows(() => buildTubeGeometry(trace(), 1.5), Error, 'positive integer');
});

Deno.test('a minimal 2-point run still produces a valid single-quad strip', () => {
  const two = { guide: Float32Array.from([0,0,0, 1,0,0]), residue: Uint32Array.from([0,1]), runs: Uint32Array.from([0,2]) };
  const geo = buildTubeGeometry(two, 3);
  assertStrictEquals(geo.count, 4); // 1 segment * 3 + 1
  assertStrictEquals(geo.segments[0], 1);
  assertStrictEquals(geo.segments[geo.segments.length - 1], 2);
  for (let i = 1; i < geo.segments.length - 1; i++) assertStrictEquals(geo.segments[i], 3);
});
