import { assert, assertStrictEquals, assertThrows } from "@std/assert";
import { buildRibbonGeometry } from "../src/internal/ribbon-geometry.ts";

const RING_SIDES = 16;

/** Two runs: a 4-residue helix run and a far-away 3-residue coil run, plus a 1-residue run. */
function fixture() {
  const guide = Float32Array.from([
    0,
    0,
    0,
    1,
    0,
    0,
    2,
    1,
    0,
    3,
    1,
    0, // run0 (helix): residues 0..3
    50,
    0,
    0, // run1 (isolated): residue 4
    100,
    0,
    0,
    101,
    0,
    0,
    102,
    1,
    0, // run2 (coil): residues 5..7
  ]);
  const residue = Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
  const runs = Uint32Array.from([0, 4, 5, 8]);
  const direction = Float32Array.from(
    Array.from({ length: 8 }, () => [0, 0, 1]).flat(),
  );
  const kind: ("helix" | "sheet" | "coil")[] = [
    "helix",
    "helix",
    "helix",
    "helix",
    "coil",
    "coil",
    "coil",
    "coil",
  ];
  const first = Uint8Array.from([1, 0, 0, 1, 1, 1, 0, 1]);
  const last = Uint8Array.from([0, 0, 0, 1, 1, 0, 0, 1]);
  return {
    trace: { guide, residue, runs },
    ss: { count: 8, direction, kind, first, last },
  };
}

function assertFinite(arr: Iterable<number>) {
  for (const v of arr) assert(Number.isFinite(v));
}

Deno.test("drops the single-residue run and keeps the two multi-residue runs", () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  assert(mesh.vertexCount > 0);
  // Ring vertices/sample plus a closed cap at both ends of each drawn run.
  const samplesRun0 = 3 * 4 + 1, samplesRun2 = 2 * 4 + 1;
  assertStrictEquals(
    mesh.vertexCount,
    (samplesRun0 + samplesRun2) * RING_SIDES + 4 * (RING_SIDES + 1),
  );
  assertStrictEquals(
    mesh.triangleCount,
    (samplesRun0 - 1 + samplesRun2 - 1) * RING_SIDES * 2 + 4 * RING_SIDES,
  );
});

Deno.test("every vertex, normal, and residue mapping is finite and in range", () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 6);
  assertFinite(mesh.positions);
  assertFinite(mesh.normals);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(
      mesh.normals[i],
      mesh.normals[i + 1],
      mesh.normals[i + 2],
    );
    assert(Math.abs(len - 1) < 1e-4, `normal ${i / 3} is not unit length`);
  }
  for (const row of mesh.residue) assert([0, 1, 2, 3, 5, 6, 7].includes(row));
  for (const i of mesh.indices) assert(i >= 0 && i < mesh.vertexCount);
});

Deno.test("triangle winding agrees with outward vertex normals", () => {
  const trace = {
    guide: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
    residue: Uint32Array.from([0, 1, 2, 3]),
    runs: Uint32Array.from([0, 4]),
  };
  const ss = {
    count: 4,
    direction: Float32Array.from(
      Array.from({ length: 4 }, () => [0, 0, 1]).flat(),
    ),
    kind: ["coil", "coil", "coil", "coil"] as const,
    first: Uint8Array.from([1, 0, 0, 0]),
    last: Uint8Array.from([0, 0, 0, 1]),
  };
  const mesh = buildRibbonGeometry(trace, ss, 4);
  const point = (index: number) => [
    mesh.positions[index * 3],
    mesh.positions[index * 3 + 1],
    mesh.positions[index * 3 + 2],
  ];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i], b = mesh.indices[i + 1], c = mesh.indices[i + 2];
    const p = point(a), q = point(b), r = point(c);
    const ab = q.map((v, axis) => v - p[axis]);
    const ac = r.map((v, axis) => v - p[axis]);
    const face = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (Math.hypot(...face) < 1e-8) continue;
    const average = [0, 1, 2].map((axis) =>
      (mesh.normals[a * 3 + axis] + mesh.normals[b * 3 + axis] +
        mesh.normals[c * 3 + axis]) / 3
    );
    const alignment = face.reduce((sum, v, axis) => sum + v * average[axis], 0);
    assert(
      alignment > 0,
      `triangle ${i / 3} must face along its normals; alignment ${alignment}`,
    );
  }
});

Deno.test("never bridges two runs: the two runs occupy disjoint position clusters", () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  const runOfResidue = (row: number) => row <= 3 ? 0 : 2;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const runs = [0, 1, 2].map((k) =>
      runOfResidue(mesh.residue[mesh.indices[i + k]])
    );
    assertStrictEquals(runs[0], runs[1]);
    assertStrictEquals(runs[1], runs[2]);
  }
});

Deno.test("helix profile broadens along the residue normal", () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  const extentAt = (residueRow: number) => {
    let min = Infinity, max = -Infinity;
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (mesh.residue[v] !== residueRow) continue;
      min = Math.min(min, mesh.positions[v * 3 + 2]);
      max = Math.max(max, mesh.positions[v * 3 + 2]);
    }
    return max - min;
  };
  assert(
    extentAt(1) > extentAt(6),
    "a helix residue should be broader than a coil residue along its normal",
  );
});

Deno.test("helix and coil profiles ease smoothly across their boundary", () => {
  const trace = {
    guide: Float32Array.from([
      0,
      0,
      0,
      1,
      0,
      0,
      2,
      0,
      0,
      3,
      0,
      0,
    ]),
    residue: Uint32Array.from([0, 1, 2, 3]),
    runs: Uint32Array.from([0, 4]),
  };
  const ss = {
    count: 4,
    direction: Float32Array.from(
      Array.from({ length: 4 }, () => [0, 0, 1]).flat(),
    ),
    kind: ["coil", "coil", "helix", "helix"] as const,
    first: Uint8Array.from([1, 0, 1, 0]),
    last: Uint8Array.from([0, 1, 0, 1]),
  };
  const mesh = buildRibbonGeometry(trace, ss, 4);
  const radiusAt = (ring: number) => {
    const start = ring * RING_SIDES;
    const center = [0, 1, 2].map((axis) => {
      let sum = 0;
      for (let side = 0; side < RING_SIDES; side++) {
        sum += mesh.positions[(start + side) * 3 + axis];
      }
      return sum / RING_SIDES;
    });
    return Math.max(...Array.from({ length: RING_SIDES }, (_, side) => {
      const offset = (start + side) * 3;
      return Math.hypot(
        mesh.positions[offset] - center[0],
        mesh.positions[offset + 1] - center[1],
        mesh.positions[offset + 2] - center[2],
      );
    }));
  };
  const radii = [4, 5, 6, 7, 8].map(radiusAt);
  const steps = radii.slice(1).map((radius, i) => radius - radii[i]);
  assert(
    steps.every((step) => step > 0),
    "the profile should widen monotonically",
  );
  assert(
    Math.abs(steps[0] - steps[3]) < 1e-4 &&
      Math.abs(steps[1] - steps[2]) < 1e-4,
    "the eased shoulder has matching growth at both ends",
  );
});

Deno.test("alternating carbonyl directions keep a continuous sheet face", () => {
  const trace = {
    guide: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
    residue: Uint32Array.from([0, 1, 2, 3]),
    runs: Uint32Array.from([0, 4]),
  };
  const ss = {
    count: 4,
    direction: Float32Array.from([0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 0, -1]),
    kind: ["sheet", "sheet", "sheet", "sheet"] as const,
    first: Uint8Array.from([1, 0, 0, 0]),
    last: Uint8Array.from([0, 0, 0, 1]),
  };
  const mesh = buildRibbonGeometry(trace, ss, 4);
  for (const ring of [0, 4, 8]) {
    const top = (ring * RING_SIDES + RING_SIDES / 4) * 3;
    assert(mesh.positions[top + 2] > 0.5, `sheet face flipped at ring ${ring}`);
  }
});

Deno.test("beta sheet ends widen into an arrow shoulder and converge to a point", () => {
  const guide = Float32Array.from([
    0,
    0,
    0,
    1,
    0,
    0,
    2,
    0,
    0,
    3,
    0,
    0,
    4,
    0,
    0,
    5,
    0,
    0,
  ]);
  const kind = ["sheet", "sheet", "sheet", "sheet", "sheet", "coil"] as const;
  const ss = {
    count: 6,
    direction: Float32Array.from(
      Array.from({ length: 6 }, () => [0, 0, 1]).flat(),
    ),
    kind,
    first: Uint8Array.from([1, 0, 0, 0, 1, 1]),
    last: Uint8Array.from([0, 0, 0, 0, 1, 1]),
  };
  const mesh = buildRibbonGeometry(
    {
      guide,
      residue: Uint32Array.from([0, 1, 2, 3, 4, 5]),
      runs: Uint32Array.from([0, 6]),
    },
    ss,
    4,
  );

  const ringExtentAtX = (x: number, axis: number) => {
    let max = 0;
    const bodyVertexCount = (5 * 4 + 1) * RING_SIDES;
    for (let start = 0; start < bodyVertexCount; start += RING_SIDES) {
      const centerX = Array.from({ length: RING_SIDES }, (_, corner) => corner)
        .reduce(
          (sum, corner) => sum + mesh.positions[(start + corner) * 3],
          0,
        ) / RING_SIDES;
      if (Math.abs(centerX - x) > 1e-4) continue;
      const values = Array.from(
        { length: RING_SIDES },
        (_, side) => mesh.positions[(start + side) * 3 + axis],
      );
      max = Math.max(max, Math.max(...values) - Math.min(...values));
    }
    return max;
  };

  assert(
    ringExtentAtX(3, 2) > ringExtentAtX(2, 2),
    "the penultimate sheet residue should widen into the arrow shoulder",
  );
  assert(
    ringExtentAtX(4, 2) < 1e-4,
    "the terminal sheet should taper to a point in the sheet plane",
  );
  assert(
    ringExtentAtX(4, 1) > 0.39,
    "the arrow tip must retain its thickness across the binormal",
  );
});

Deno.test("empty trace (no runs) produces zero geometry", () => {
  const mesh = buildRibbonGeometry({
    guide: new Float32Array(),
    residue: new Uint32Array(),
    runs: Uint32Array.from([0]),
  }, {
    direction: new Float32Array(),
    kind: [],
    first: new Uint8Array(),
    last: new Uint8Array(),
  }, 4);
  assertStrictEquals(mesh.count, 0);
  assertStrictEquals(mesh.vertexCount, 0);
  assertStrictEquals(mesh.triangleCount, 0);
});

Deno.test("rejects a non-positive-integer linearSegments", () => {
  const { trace, ss } = fixture();
  assertThrows(
    () => buildRibbonGeometry(trace, ss, 0),
    Error,
    "positive integer",
  );
  assertThrows(
    () => buildRibbonGeometry(trace, ss, 2.5),
    Error,
    "positive integer",
  );
});
