// X2 (hardening) Node-level half of the invalidation/resource audit: the
// dev-only counters themselves, the kernel-level rows that are genuinely
// exercised without Live/GPU, and cache bounds under churn. The per-
// representation change->work matrix runs in a real WebGPU tab
// (run-invalidation.mjs, `npm run test:viewer:invalidation`) because it lives
// in Live components' memo keys and GPU sources.
//
// Violations are recorded as node:test `todo` (named), not fixed here.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStructure, withPositions } from '@molgpu/table';
import { where } from '@molgpu/select';
import { createStructureResource } from '../src/internal/structure-resource.mjs';
import { buildBondColumns } from '../src/internal/bond-columns.mjs';
import { focusSelection } from '../src/camera-curve.mjs';
import { geometryDeps } from '../src/internal/geometry-job.mjs';
import {
  count, countOnce, gauge, trackOwnedBuffer, releaseOwnedBuffer, instrumentDevice,
  enableInstrumentation, disableInstrumentation, resetAllInstrumentation, snapshotCounters,
} from '../src/internal/instrumentation.mjs';

const N = 40;
const structure = ({ bonds = false } = {}) => createStructure({
  positions: Float32Array.from({ length: N * 3 }, (_, i) => (i % 3 === 0 ? (i / 3) * 1.4 : 0)),
  topology: {
    atoms: { count: N, id: Array.from({ length: N }, (_, i) => String(i + 1)), name: Array.from({ length: N }, (_, i) => `C${i}`), altloc: new Array(N).fill(''),
      residue: new Uint32Array(N), element: new Uint8Array(N).fill(6), occupancy: new Float32Array(N).fill(1),
      bfactor: new Float32Array(N), radius: new Float32Array(N).fill(1.7) },
    residues: { count: 1, chain: new Uint32Array([0]), labelSeq: new Int32Array([1]), authSeq: ['1'], insertionCode: [''], comp: ['LIG'], polymer: ['other'] },
    chains: { count: 1, model: new Int32Array([1]), labelId: ['A'], authId: ['A'] },
    bonds: bonds
      ? { count: N - 1, a: Uint32Array.from({ length: N - 1 }, (_, i) => i), b: Uint32Array.from({ length: N - 1 }, (_, i) => i + 1),
          order: new Uint8Array(N - 1).fill(1), source: new Array(N - 1).fill('explicit') }
      : { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: 1, chain: new Uint32Array([0]), operatorId: ['1'], transform: new Float64Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) },
  },
});

beforeEach(() => { resetAllInstrumentation(); enableInstrumentation(); });

test('counters are inert while disabled and attribute work per label when enabled', () => {
  disableInstrumentation();
  count('geometryBuilds', 'x'); gauge('g', 5); trackOwnedBuffer({}, 'x');
  let s = snapshotCounters();
  assert.equal(s.geometryBuilds, 0); assert.deepEqual(s.detail, {}); assert.deepEqual(s.gauges, {});
  assert.equal(s.ownedBuffers.created, 0);
  enableInstrumentation();
  count('geometryBuilds', 'tube:spline'); count('uploadBytes', 'positions', 96); gauge('g', 3); gauge('g', 7); gauge('g', 2);
  s = snapshotCounters();
  assert.equal(s.geometryBuilds, 1); assert.equal(s.uploadBytes, 96);
  assert.deepEqual(s.detail, { 'geometryBuilds:tube:spline': 1, 'uploadBytes:positions': 96 });
  assert.equal(s.gauges.g, 7, 'a gauge records its high-water mark');
});

test('owned buffers count one allocation and one release each', () => {
  const a = {}, b = {};
  trackOwnedBuffer(a, 'positions'); trackOwnedBuffer(a, 'positions'); trackOwnedBuffer(b, 'radii');
  releaseOwnedBuffer(a); releaseOwnedBuffer(a);
  const s = snapshotCounters();
  assert.equal(s.allocations, 2);
  assert.deepEqual(s.ownedBuffers, { created: 2, destroyed: 1, live: 1 });
});

test('instrumentDevice counts every buffer created/destroyed and bytes written by usage', () => {
  const STORAGE = 0x80, UNIFORM = 0x40;
  const device = {
    createBuffer: (desc) => ({ usage: desc.usage, destroy() {} }),
    queue: { writeBuffer() {} },
  };
  instrumentDevice(device);
  instrumentDevice(device); // idempotent
  const s1 = device.createBuffer({ size: 16, usage: STORAGE }), u1 = device.createBuffer({ size: 16, usage: UNIFORM });
  device.queue.writeBuffer(s1, 0, new Float32Array(4));
  device.queue.writeBuffer(u1, 0, new Float32Array(8).buffer, 0, 16);
  device.queue.writeBuffer(s1, 0, new Float32Array(4), 1, 2);
  s1.destroy(); s1.destroy();
  const s = snapshotCounters().deviceBuffers;
  assert.deepEqual({ created: s.created, destroyed: s.destroyed, live: s.live }, { created: 2, destroyed: 1, live: 1 });
  assert.deepEqual(s.writeBytes, { storage: 16 + 8, uniform: 16, other: 0 });
});

test('bond columns: explicit connectivity never counts a topology build, even on a coordinate edit', () => {
  const data = structure({ bonds: true });
  buildBondColumns(data, null, 'both');
  buildBondColumns(withPositions(data, data.positions.map((v) => v * 1.01)), null, 'both');
  const s = snapshotCounters();
  assert.equal(s.topologyBuilds, 0);
  assert.equal(s.detail['geometryBuilds:bonds:columns'], 2, 'coordinates are baked into bond vertices, so geometry rebuilds');
});

test('bond columns: inferred connectivity is built once per positions revision (a coordinate-dependent derivation)', () => {
  const data = structure();
  buildBondColumns(data, null, 'both');
  buildBondColumns(data, null, 'both', true); // cache hit in @molgpu/table
  assert.equal(snapshotCounters().detail['topologyBuilds:bonds:infer'], 1);
  buildBondColumns(withPositions(data, data.positions.map((v) => v * 1.01)), null, 'both');
  assert.equal(snapshotCounters().detail['topologyBuilds:bonds:infer'], 2);
});

test('surface scheduling: probe/resolution edits change the geometry key, colour/opacity cannot enter it', () => {
  const resource = createStructureResource(structure());
  const indices = Uint32Array.from({ length: N }, (_, i) => i);
  const key = (p) => JSON.stringify(geometryDeps(resource, p).slice(3));
  const base = key({ indices, probeRadius: 1.4, resolution: 0.5 });
  assert.notEqual(key({ indices, probeRadius: 1.6, resolution: 0.5 }), base);
  assert.notEqual(key({ indices, probeRadius: 1.4, resolution: 0.7 }), base);
  assert.throws(() => geometryDeps(resource, { indices, color: [1, 0, 0, 1] }), /style parameter/);
  assert.throws(() => geometryDeps(resource, { indices, opacity: 0.5 }), /style parameter/);
});

test('selection cache stays bounded under churn (5000 distinct selections)', () => {
  const resource = createStructureResource(structure(), { maxSelections: 64 });
  const first = resource.selection(Uint32Array.of(0));
  for (let k = 0; k < 5000; k++) {
    const lo = k % N, len = 1 + (Math.floor(k / N) % (N - lo));
    resource.selection(Uint32Array.from({ length: len }, (_, i) => lo + i));
  }
  const s = snapshotCounters();
  assert.ok(s.gauges.selectionCacheSize <= 64, `selection cache exceeded its bound: ${s.gauges.selectionCacheSize}`);
  assert.equal(s.gauges.selectionCacheSize, 64, 'the churn filled the cache to exactly its bound');
  assert.notEqual(resource.selection(Uint32Array.of(0)), first, 'the oldest mapping was evicted');
});

test('selection cache honours a custom bound and releases everything on dispose', () => {
  const resource = createStructureResource(structure(), { maxSelections: 3 });
  for (let k = 0; k < 100; k++) resource.selection(Uint32Array.of(k % N));
  assert.equal(snapshotCounters().gauges.selectionCacheSize, 3);
  resource.dispose();
  assert.throws(() => resource.selection(Uint32Array.of(0)), /disposed/);
});

// focusSelection caches one framing per (resource, query, options). The
// options key includes the continuous `aspect`, so resizing a canvas while
// focused on one query adds one entry per distinct aspect, with no bound
// (camera-curve.mjs: `byOptions` is a plain Map). Violation filed from X2.
test('focus framing cache stays bounded under aspect churn', {
  todo: 'VIOLATION: camera-curve.mjs focusSelection byOptions Map grows by one entry per distinct aspect/fov/padding (unbounded)',
}, () => {
  const resource = createStructureResource(structure());
  const query = where('atom', 'all', () => true);
  for (let k = 0; k < 500; k++) focusSelection(resource, query, { aspect: 1 + k / 1000 });
  const size = snapshotCounters().gauges.focusCacheOptions;
  assert.ok(size <= 64, `focus framing cache holds ${size} entries after 500 aspect values`);
});
