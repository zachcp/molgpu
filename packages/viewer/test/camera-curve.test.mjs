import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructure, withPositions } from '@molgpu/table';
import { all, where, resolve } from '@molgpu/select';
import { createStructureResource } from '../src/internal/structure-resource.mjs';
import { focusSelection, createCameraCurve, sampleCamera } from '../src/camera-curve.mjs';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shifted = [...identity]; shifted[12] = 10;
const data = createStructure({
  positions: Float32Array.from([0, 0, 0, 2, 0, 0]),
  topology: {
    atoms: {
      count: 2, id: ['1', '2'], name: ['C', 'O'], altloc: ['', ''],
      residue: Uint32Array.from([0, 0]), element: Uint8Array.from([6, 8]),
      occupancy: Float32Array.of(1, 1), bfactor: new Float32Array(2), radius: Float32Array.of(1, 1),
    },
    residues: { count: 1, chain: Uint32Array.of(0), labelSeq: Int32Array.of(1), authSeq: ['1'], insertionCode: [''], comp: ['GLY'], polymer: ['protein'] },
    chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
    bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: 2, chain: Uint32Array.of(0, 0), operatorId: ['id', 'shift'], transform: Float64Array.from([...identity, ...shifted]) },
  },
});

test('focus includes displayed radii and assembly transforms', () => {
  const resource = createStructureResource(data);
  const view = focusSelection(resource, all('atom'));
  assert.deepEqual(view.bounds, { min: [-1, -1, -1], max: [13, 1, 1], center: [6, 0, 0] });
  assert.deepEqual(view.target, [6, 0, 0]);
  assert.ok(view.radius > 14);
  assert.deepEqual(focusSelection(resource, all('atom'), { atomRadiusScale: 0 }).bounds.min, [0, 0, 0]);
  resource.dispose();
  assert.throws(() => focusSelection(resource, all('atom')), /disposed/);
});

test('empty focus has a defined full-structure fallback or no-op', () => {
  const resource = createStructureResource(data);
  const none = where('atom', 'none', () => false);
  assert.deepEqual(focusSelection(resource, none).target, [6, 0, 0]);
  assert.equal(focusSelection(resource, none, { empty: 'null' }), null);
  assert.throws(() => focusSelection(resource, none, { empty: 'error' }), /empty/);
  assert.throws(() => focusSelection(resource, resolve(all('atom'), data)), /SelectionQuery/);
});

test('camera focus resolves current positions on every sample and rewinds', () => {
  let evaluations = 0;
  const query = where('atom', 'oxygen', (table, i) => {
    evaluations++;
    return table.topology.atoms.element[i] === 8;
  });
  const curve = createCameraCurve([
    { time: 0, target: [0, 0, 0], radius: 20, bearing: 0, pitch: 0 },
    { time: 2, focus: query, bearing: 1, pitch: 0.25 },
  ]);
  const first = createStructureResource(data);
  const start = sampleCamera(curve, 0, first);
  const end = sampleCamera(curve, 2, first);
  assert.deepEqual(start.target, [0, 0, 0]);
  assert.deepEqual(end.target, [7, 0, 0]);
  assert.deepEqual(sampleCamera(curve, 1, first).target, [3.5, 0, 0]);
  assert.deepEqual(sampleCamera(curve, 0, first), start);
  assert.equal(evaluations, 2, 'same resource caches the resolved focus while scrubbing');

  const moved = createStructureResource(withPositions(data, Float32Array.from([0, 0, 0, 4, 0, 0])));
  assert.deepEqual(sampleCamera(curve, 2, moved).target, [9, 0, 0]);
  assert.deepEqual(sampleCamera(curve, 0, moved), start);
  assert.equal(evaluations, 4, 'coordinate revision re-resolves the query');

  const swapped = createStructureResource(createStructure({
    topology: data.topology, positions: Float32Array.from([0, 0, 0, 8, 0, 0]),
  }));
  assert.deepEqual(sampleCamera(curve, 2, swapped).target, [13, 0, 0]);
  assert.equal(evaluations, 6, 'dataset replacement re-resolves the query');
});
