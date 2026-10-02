import {
  assert,
  assertAlmostEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { buildRibbonGeometry } from "../src/internal/ribbon-geometry.ts";

type Kind = "helix" | "sheet" | "coil";
const RADIAL = 16;

/** A straight trace along +x, one guide point per Ångström, carbonyls along +z. */
function line(kinds: Kind[], directions?: number[][]) {
  const n = kinds.length;
  return {
    trace: {
      guide: Float32Array.from(
        Array.from({ length: n }, (_, i) => [i, 0, 0]).flat(),
      ),
      residue: Uint32Array.from(kinds.keys()),
      runs: Uint32Array.from([0, n]),
    },
    ss: {
      direction: Float32Array.from(
        (directions ?? kinds.map(() => [0, 0, 1])).flat(),
      ),
      kind: kinds,
    },
  };
}

/** Two runs: a 4-residue helix run and a far-away 3-residue coil run, plus a 1-residue run. */
function fixture() {
  const guide = Float32Array.from([
    [0, 0, 0],
    [1, 0, 0],
    [2, 1, 0],
    [3, 1, 0], // run0 (helix): residues 0..3
    [50, 0, 0], // run1 (isolated): residue 4
    [100, 0, 0],
    [101, 0, 0],
    [102, 1, 0], // run2 (coil): residues 5..7
  ].flat());
  const kind: Kind[] = [
    "helix",
    "helix",
    "helix",
    "helix",
    "coil",
    "coil",
    "coil",
    "coil",
  ];
  return {
    trace: {
      guide,
      residue: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
      runs: Uint32Array.from([0, 4, 5, 8]),
    },
    ss: {
      direction: Float32Array.from(
        Array.from({ length: 8 }, () => [0, 0, 1]).flat(),
      ),
      kind,
    },
  };
}

type Mesh = ReturnType<typeof buildRibbonGeometry>;

/** Extent along `axis` of residue `row`'s vertices whose x lies within `tol` of `x`. */
function extentAt(
  mesh: Mesh,
  row: number,
  x: number,
  axis: number,
  tol = 1e-3,
) {
  let min = Infinity, max = -Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    if (mesh.residue[v] !== row) continue;
    if (Math.abs(mesh.positions[v * 3] - x) > tol) continue;
    min = Math.min(min, mesh.positions[v * 3 + axis]);
    max = Math.max(max, mesh.positions[v * 3 + axis]);
  }
  return max - min;
}

function assertOutward(mesh: Mesh) {
  const point = (index: number) =>
    [0, 1, 2].map((c) => mesh.positions[index * 3 + c]);
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.subarray(i, i + 3);
    const p = point(a), q = point(b), r = point(c);
    const ab = q.map((v, axis) => v - p[axis]);
    const ac = r.map((v, axis) => v - p[axis]);
    const face = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (Math.hypot(...face) < 1e-8) continue;
    const alignment = [0, 1, 2].reduce(
      (sum, axis) =>
        sum + face[axis] *
          (mesh.normals[a * 3 + axis] + mesh.normals[b * 3 + axis] +
            mesh.normals[c * 3 + axis]),
      0,
    );
    assert(alignment > 0, `triangle ${i / 3} faces against its normals`);
  }
}

Deno.test("a fixed coil trace has the oracle vertex and triangle counts", () => {
  const { trace, ss } = line(["coil", "coil", "coil", "coil"]);
  const mesh = buildRibbonGeometry(trace, ss, 4);
  // Terminal residues keep half a segment (2 of 4 samples) plus a flat cap;
  // inner residues draw a full 4-sample segment without caps.
  const terminal = 3 * RADIAL + (RADIAL + 1), inner = 5 * RADIAL;
  assertStrictEquals(mesh.vertexCount, 2 * terminal + 2 * inner);
  const terminalTris = 2 * RADIAL * 2 + RADIAL, innerTris = 4 * RADIAL * 2;
  assertStrictEquals(mesh.triangleCount, 2 * terminalTris + 2 * innerTris);
});

Deno.test("run ends overhang their guide points and are capped", () => {
  const { trace, ss } = line(["coil", "coil", "coil", "coil"]);
  const mesh = buildRibbonGeometry(trace, ss, 4);
  let min = Infinity, max = -Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    min = Math.min(min, mesh.positions[v * 3]);
    max = Math.max(max, mesh.positions[v * 3]);
  }
  // Mol*'s overhang: twice the 0.2 Å cartoon size past each terminal guide.
  assertAlmostEquals(min, -0.4, 1e-4);
  assertAlmostEquals(max, 3.4, 1e-4);
  assert(extentAt(mesh, 0, -0.4, 1) > 0.39, "the start cap spans the tube");
});

Deno.test("a single-residue run is drawn as a sphere, not dropped", () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  let max = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    if (mesh.residue[v] !== 4) continue;
    max = Math.max(
      max,
      Math.hypot(
        mesh.positions[v * 3] - 50,
        mesh.positions[v * 3 + 1],
        mesh.positions[v * 3 + 2],
      ),
    );
  }
  assertAlmostEquals(max, 0.4, 1e-5);
});

Deno.test("every vertex, normal, and residue mapping is finite and in range", () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 6);
  for (const v of mesh.positions) assert(Number.isFinite(v));
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(
      mesh.normals[i],
      mesh.normals[i + 1],
      mesh.normals[i + 2],
    );
    assert(Math.abs(len - 1) < 1e-4, `normal ${i / 3} is not unit length`);
  }
  for (const row of mesh.residue) assert(row <= 7);
  for (const i of mesh.indices) assert(i >= 0 && i < mesh.vertexCount);
});

Deno.test("triangle winding agrees with outward normals for tube, sheet and arrow", () => {
  for (
    const kinds of [
      ["coil", "coil", "coil", "coil"],
      ["coil", "helix", "helix", "helix", "coil"],
      ["coil", "sheet", "sheet", "sheet", "coil"],
      ["sheet", "sheet", "sheet"],
    ] as Kind[][]
  ) {
    const { trace, ss } = line(kinds);
    assertOutward(buildRibbonGeometry(trace, ss, 4));
  }
});

Deno.test("never bridges two runs", () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  const runOfResidue = (row: number) => row <= 3 ? 0 : row === 4 ? 1 : 2;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const runs = [0, 1, 2].map((k) =>
      runOfResidue(mesh.residue[mesh.indices[i + k]])
    );
    assertStrictEquals(runs[0], runs[1]);
    assertStrictEquals(runs[1], runs[2]);
  }
});

Deno.test("helix and sheet are broad along the carbonyl normal, coil is round", () => {
  const { trace, ss } = line([
    "coil",
    "helix",
    "helix",
    "coil",
    "sheet",
    "sheet",
    "sheet",
    "coil",
  ]);
  const mesh = buildRibbonGeometry(trace, ss, 4);
  // Full extents: 2 × 0.2 Å thick, 2 × 1.0 Å broad.
  assertAlmostEquals(extentAt(mesh, 1, 1, 2), 2, 1e-4);
  assertAlmostEquals(extentAt(mesh, 1, 1, 1), 0.4, 1e-4);
  assertAlmostEquals(extentAt(mesh, 5, 5, 2), 2, 1e-4);
  assertAlmostEquals(extentAt(mesh, 5, 5, 1), 0.4, 1e-4);
  assertAlmostEquals(extentAt(mesh, 3, 3, 2), 0.4, 1e-4);
  assertAlmostEquals(extentAt(mesh, 3, 3, 1), 0.4, 1e-4);
});

Deno.test("the last sheet residue is an arrowhead: 1.5× shoulder tapering to an edge", () => {
  const { trace, ss } = line([
    "coil",
    "sheet",
    "sheet",
    "sheet",
    "sheet",
    "coil",
  ]);
  const mesh = buildRibbonGeometry(trace, ss, 4);
  // Residue 4's segment runs from x = 3.5 to just short of 4.5: the end
  // tension of a secondary-structure block bends the spline parameter.
  assertAlmostEquals(extentAt(mesh, 3, 3, 2), 2, 1e-4);
  assertAlmostEquals(extentAt(mesh, 4, 3.5, 2), 3, 1e-4);
  assertAlmostEquals(extentAt(mesh, 4, 4.47, 2, 0.05), 0, 1e-4);
  assertAlmostEquals(extentAt(mesh, 4, 4.47, 1, 0.05), 0.4, 1e-4);
});

Deno.test("alternating carbonyl directions keep one sheet plane", () => {
  const { trace, ss } = line(
    ["sheet", "sheet", "sheet", "sheet", "sheet"],
    [[0, 0, 1], [0, 0, -1], [0, 0, 1], [0, 0, -1], [0, 0, 1]],
  );
  const mesh = buildRibbonGeometry(trace, ss, 4);
  for (const row of [1, 2, 3]) {
    assertAlmostEquals(extentAt(mesh, row, row, 2), 2, 1e-4);
    assertAlmostEquals(extentAt(mesh, row, row, 1), 0.4, 1e-4);
  }
});

Deno.test("a nucleic run is a flat strand broad along the binormal", () => {
  const { trace, ss } = line(["coil", "coil", "coil", "coil"]);
  const mesh = buildRibbonGeometry(
    { ...trace, runKind: ["dna"] },
    ss,
    10,
  );
  assertAlmostEquals(extentAt(mesh, 1, 1, 1), 2, 1e-4);
  assertAlmostEquals(extentAt(mesh, 1, 1, 2), 0.4, 1e-4);
});

Deno.test("empty trace (no runs) produces zero geometry", () => {
  const mesh = buildRibbonGeometry(
    {
      guide: new Float32Array(),
      residue: new Uint32Array(),
      runs: Uint32Array.from([0]),
    },
    { direction: new Float32Array(), kind: [] },
    4,
  );
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
