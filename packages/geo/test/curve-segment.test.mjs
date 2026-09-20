import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCurveSegmentState, interpolateCurveSegment, interpolateSizes,
} from '../src/index.mjs';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra.js';
import {
  createCurveSegmentState as oracleState,
  interpolateCurveSegment as oracleInterpolate,
  interpolateSizes as oracleInterpolateSizes,
} from 'molstar/lib/mol-repr/structure/visual/util/polymer/curve-segment.js';

function controls(overrides = {}) {
  return {
    p0: Vec3.create(-1, 2, 0.5),
    p1: Vec3.create(0, 0, 0),
    p2: Vec3.create(1, 1, 0),
    p3: Vec3.create(2, 0.5, 1),
    p4: Vec3.create(3, -1, 1.5),
    d12: Vec3.create(0, 1, 0),
    d23: Vec3.create(0, 0, 1),
    secStrucFirst: false,
    secStrucLast: false,
    ...overrides,
  };
}

function assertArraysClose(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Number.isFinite(actual[i]), `index ${i} is not finite: ${actual[i]}`);
    assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `index ${i}: ${actual[i]} vs ${expected[i]}`);
  }
}

test('matches the pinned Mol* oracle for points, tangents, normals, binormals', () => {
  const linearSegments = 8;
  const ours = createCurveSegmentState(linearSegments);
  const oracle = oracleState(linearSegments);
  const c = controls();

  interpolateCurveSegment(ours, c, 0.5, 0);
  oracleInterpolate(oracle, c, 0.5, 0);

  assertArraysClose(ours.curvePoints, oracle.curvePoints);
  assertArraysClose(ours.tangentVectors, oracle.tangentVectors);
  assertArraysClose(ours.normalVectors, oracle.normalVectors);
  assertArraysClose(ours.binormalVectors, oracle.binormalVectors);
});

test('matches the oracle when secondary-structure ends pin tension to 0.5', () => {
  const linearSegments = 6;
  const ours = createCurveSegmentState(linearSegments);
  const oracle = oracleState(linearSegments);
  const c = controls({ secStrucFirst: true, secStrucLast: true });

  interpolateCurveSegment(ours, c, 0.8, 0.25);
  oracleInterpolate(oracle, c, 0.8, 0.25);

  assertArraysClose(ours.curvePoints, oracle.curvePoints);
  assertArraysClose(ours.tangentVectors, oracle.tangentVectors);
  assertArraysClose(ours.normalVectors, oracle.normalVectors);
  assertArraysClose(ours.binormalVectors, oracle.binormalVectors);
});

test('matches the oracle deterministic fallback when the frame direction is degenerate', () => {
  const linearSegments = 4;
  const ours = createCurveSegmentState(linearSegments);
  const oracle = oracleState(linearSegments);
  // p0..p4 collinear along x: tangent is along x, and d12/d23 are also along
  // x, forcing orthogonalize() through its parallel-vector fallback branches.
  const c = controls({
    p0: Vec3.create(0, 0, 0), p1: Vec3.create(1, 0, 0), p2: Vec3.create(2, 0, 0),
    p3: Vec3.create(3, 0, 0), p4: Vec3.create(4, 0, 0),
    d12: Vec3.create(1, 0, 0), d23: Vec3.create(-1, 0, 0),
  });

  interpolateCurveSegment(ours, c, 0.5, 0);
  oracleInterpolate(oracle, c, 0.5, 0);

  assertArraysClose(ours.normalVectors, oracle.normalVectors);
  assertArraysClose(ours.binormalVectors, oracle.binormalVectors);
  for (const v of ours.normalVectors) assert.ok(Number.isFinite(v));
});

test('matches the oracle for width/height taper', () => {
  const linearSegments = 5;
  const ours = createCurveSegmentState(linearSegments);
  const oracle = oracleState(linearSegments);

  interpolateSizes(ours, 1, 2, 0.5, 0.2, 0.4, 0.1, 0.3);
  oracleInterpolateSizes(oracle, 1, 2, 0.5, 0.2, 0.4, 0.1, 0.3);

  assertArraysClose(ours.widthValues, oracle.widthValues);
  assertArraysClose(ours.heightValues, oracle.heightValues);
});

test('produces linearSegments + 1 samples with no NaNs', () => {
  const state = createCurveSegmentState(10);
  interpolateCurveSegment(state, controls(), 0.5, 0);
  assert.equal(state.curvePoints.length, 33);
  for (const arr of [state.curvePoints, state.tangentVectors, state.normalVectors, state.binormalVectors]) {
    for (const v of arr) assert.ok(Number.isFinite(v));
  }
});
