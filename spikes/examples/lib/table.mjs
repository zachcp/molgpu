// The columnar atom table — the shape @molgpu/table would own.
// Plain typed arrays, no GPU and no Mol* types. Everything downstream is a
// function of this.
import { XYZ, EL, RES, BB, RESNAME, RESSEQ, VDW } from '../crambin.mjs';

export const ELEMENT_COLOR = [
  [0.78, 0.80, 0.84, 1],   // C
  [0.35, 0.50, 0.92, 1],   // N
  [0.90, 0.36, 0.33, 1],   // O
  [0.95, 0.80, 0.30, 1],   // S
  [0.95, 0.55, 0.25, 1],   // P
];

/** Backbone codes, as generated into crambin.mjs. */
export const BACKBONE = { SIDECHAIN: 0, N: 1, CA: 2, C: 3, O: 4 };

/**
 * Atom-level table. Every column is the same length (`count`) — that invariant
 * is what lets selections be plain index lists.
 */
export function crambinTable() {
  const count = EL.length;
  const positions = new Float32Array(count * 3);
  const radius = new Float32Array(count);
  const colors = new Float32Array(count * 4);
  const element = new Uint32Array(count);
  const residue = new Uint32Array(count);
  const backbone = new Uint32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i*3]   = XYZ[i*3]   / 100;
    positions[i*3+1] = XYZ[i*3+1] / 100;
    positions[i*3+2] = XYZ[i*3+2] / 100;
    radius[i] = VDW[EL[i]];
    colors.set(ELEMENT_COLOR[EL[i]] ?? ELEMENT_COLOR[0], i * 4);
    element[i] = EL[i];
    residue[i] = RES[i];
    backbone[i] = BB[i];
  }

  return {
    count, positions, radius, colors, element, residue, backbone,
    // residue-level metadata, indexed by residue ordinal
    residues: { count: RESNAME.length, name: RESNAME, seq: RESSEQ },
  };
}

/**
 * Residue-level TRACE table — cartoon stage 1, and the foundation every cartoon
 * variant shares (tube, ribbon, arrows).
 *
 * Deliberately just another columnar table: ordered guide points plus a frame
 * per residue. Building it needs no geometry code at all, which is why it can be
 * validated by rendering a tube before any mesh work exists.
 *
 * The real version walks the polymer properly and gets its frames from
 * secondary structure; this takes CA positions in order and derives frames from
 * finite differences. Good enough to prove the shape.
 */
export function traceTable(table) {
  const { positions, backbone, residue } = table;

  // CA per residue, in residue order.
  const ca = new Int32Array(table.residues.count).fill(-1);
  for (let i = 0; i < table.count; i++) {
    if (backbone[i] === BACKBONE.CA) ca[residue[i]] = i;
  }
  const order = [];
  for (let r = 0; r < ca.length; r++) if (ca[r] >= 0) order.push(r);

  const n = order.length;
  const guide = new Float32Array(n * 3);
  const tangent = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const resIndex = new Uint32Array(n);

  order.forEach((r, k) => {
    const i = ca[r];
    guide[k*3] = positions[i*3];
    guide[k*3+1] = positions[i*3+1];
    guide[k*3+2] = positions[i*3+2];
    resIndex[k] = r;
  });

  // Tangents by central difference; normals by Gram-Schmidt against a
  // carried reference, which keeps the frame from flipping between residues.
  let ref = [0, 0, 1];
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    const t = [
      guide[b*3] - guide[a*3],
      guide[b*3+1] - guide[a*3+1],
      guide[b*3+2] - guide[a*3+2],
    ];
    norm(t);
    // normal = normalize(ref - t * dot(ref, t))
    const d = t[0]*ref[0] + t[1]*ref[1] + t[2]*ref[2];
    const nv = [ref[0] - t[0]*d, ref[1] - t[1]*d, ref[2] - t[2]*d];
    if (!norm(nv)) { nv[0] = 1; nv[1] = 0; nv[2] = 0; }
    tangent.set(t, k*3);
    normal.set(nv, k*3);
    ref = nv;                 // carry forward so the frame stays continuous
  }

  return { count: n, guide, tangent, normal, resIndex };
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l < 1e-6) return false;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return true;
}

/** Naive distance-based bonds, as flat [i,j] pairs. A real build infers these properly. */
export function inferBonds(table, cutoff = 1.9) {
  const { positions, count } = table;
  const out = [];
  const c2 = cutoff * cutoff;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const dx = positions[i*3] - positions[j*3];
    const dy = positions[i*3+1] - positions[j*3+1];
    const dz = positions[i*3+2] - positions[j*3+2];
    if (dx*dx + dy*dy + dz*dz < c2) out.push(i, j);
  }
  return Uint32Array.from(out);
}

/**
 * Subdivide a trace with a Catmull-Rom spline.
 *
 * Real cartoons always do this: consecutive CA atoms are ~3.8 A apart with sharp
 * turns between them, and extruding straight through those kinks makes the tube
 * spike at the joins. Splining both smooths the path and removes the artifact.
 *
 * This is also a preview of the portable half of cartoon geometry — Mol*'s
 * curve-segment math does the same job more thoroughly.
 */
export function subdivideTrace(trace, perSegment = 6) {
  const { guide, count } = trace;
  if (count < 2 || perSegment < 2) return trace;

  const segs = count - 1;
  const n = segs * perSegment + 1;
  const out = new Float32Array(n * 3);
  const resIndex = new Uint32Array(n);

  const P = (k, c) => {
    const i = Math.min(count - 1, Math.max(0, k));
    return guide[i*3 + c];
  };

  let w = 0;
  for (let s = 0; s < segs; s++) {
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment;
      for (let c = 0; c < 3; c++) {
        const p0 = P(s - 1, c), p1 = P(s, c), p2 = P(s + 1, c), p3 = P(s + 2, c);
        // uniform Catmull-Rom
        out[w*3 + c] = 0.5 * (
          2*p1 + (-p0 + p2) * t +
          (2*p0 - 5*p1 + 4*p2 - p3) * t*t +
          (-p0 + 3*p1 - 3*p2 + p3) * t*t*t
        );
      }
      resIndex[w] = trace.resIndex[Math.min(count - 1, s)];
      w++;
    }
  }
  // final point
  for (let c = 0; c < 3; c++) out[w*3 + c] = guide[(count-1)*3 + c];
  resIndex[w] = trace.resIndex[count - 1];

  return { count: n, guide: out, resIndex, tangent: null, normal: null };
}
