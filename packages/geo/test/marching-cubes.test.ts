import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { marchingCubes } from '../src/index.ts';
import { Tensor } from 'molstar/lib/mol-math/linear-algebra/tensor.js';
import { computeMarchingCubesMesh } from 'molstar/lib/mol-geo/util/marching-cubes/algorithm.js';

Deno.test('extracts a deterministic plane from one cube', () => {
  const mesh = marchingCubes({ values: Float32Array.from([0, 1, 1, 1, 1, 1, 1, 1]), dims: [2, 2, 2], level: 0.5 });
  assertStrictEquals(mesh.vertexCount, 3);
  assertStrictEquals(mesh.triangleCount, 1);
  // Mol*'s copied triangle table fixes this winding/order.
  assertEquals([...mesh.indices], [0, 2, 1]);
  assertEquals([...mesh.positions], [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]);
});

Deno.test('matches the pinned Mol* oracle triangle count', async () => {
  const dims: [number, number, number] = [3, 3, 3], values = new Float32Array(27);
  for (let z = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) values[x + 3 * (y + 3 * z)] = x + y + z - 1.4;
  const ours = marchingCubes({ values, dims, level: 0 });
  const space = Tensor.Space(dims, [0, 1, 2], Float32Array);
  const oracle = await computeMarchingCubesMesh({ scalarField: Tensor.create(space, Tensor.Data1(values)), isoLevel: 0 }).run();
  assertStrictEquals(ours.triangleCount, oracle.triangleCount);
});

Deno.test('maps grid coordinates into world coordinates and validates shape', () => {
  const values = Float32Array.from([0, 1, 1, 1, 1, 1, 1, 1]);
  const mesh = marchingCubes({ values, dims: [2, 2, 2], level: 0.5, origin: [10, 20, 30], spacing: [2, 3, 4] });
  assertStrictEquals(mesh.positions[0], 11);
  assertThrows(() => marchingCubes({ values, dims: [2, 2, 3] }), Error, 'length');
});
