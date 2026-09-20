// Crambin (1CRN) lowered into the REAL @molgpu/table schema.
//
// The older lib/table.mjs is an ad-hoc bag of columns. This builds the actual
// validated StructureData: explicit atom/residue/chain/bond/instance domains,
// foreign keys, and original Angstrom coordinates. createStructure() validates
// all of it, so if this file is wrong the example throws instead of rendering
// something subtly incorrect.
import { createStructure } from '@molgpu/table';
import { XYZ, EL, ELS, VDW, RES, BB, RESNAME, RESSEQ } from '../crambin.mjs';

// crambin.mjs stores an element INDEX into ELS, not an atomic number.
// @molgpu/table wants the real atomic number.
const ATOMIC_NUMBER = { C: 6, N: 7, O: 8, S: 16, P: 15 };
const BACKBONE_NAME = { 1: 'N', 2: 'CA', 3: 'C', 4: 'O' };

export const ELEMENT_COLOR = [
  [0.78, 0.80, 0.84, 1],   // C
  [0.35, 0.50, 0.92, 1],   // N
  [0.90, 0.36, 0.33, 1],   // O
  [0.95, 0.80, 0.30, 1],   // S
  [0.95, 0.55, 0.25, 1],   // P
];

/**
 * Atom names are SYNTHESIZED. The generated crambin.mjs fixture kept backbone
 * codes but dropped the PDB atom names, and the schema requires
 * (residue, name, altloc) to be unique. Backbone atoms get their real names;
 * sidechain atoms get `<element><n>` numbered within the residue, which cannot
 * collide with N/CA/C/O. Occupancy and B-factor are likewise not in the fixture,
 * so they are filled with 1.0 and 0.0 rather than invented.
 */
function atomNames(count) {
  const names = new Array(count);
  const used = new Map();
  for (let i = 0; i < count; i++) {
    const backbone = BACKBONE_NAME[BB[i]];
    if (backbone) { names[i] = backbone; continue; }
    const element = ELS[EL[i]];
    const key = `${RES[i]}:${element}`;
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    names[i] = `${element}${n}`;
  }
  return names;
}

/** Naive distance cutoff. A uniform 1.9A rule is a spike, not a bond model. */
function inferBonds(positions, count, cutoff = 1.9) {
  const a = [], b = [], c2 = cutoff * cutoff;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const dx = positions[i*3]   - positions[j*3];
    const dy = positions[i*3+1] - positions[j*3+1];
    const dz = positions[i*3+2] - positions[j*3+2];
    if (dx*dx + dy*dy + dz*dz < c2) { a.push(i); b.push(j); }
  }
  return { a: Uint32Array.from(a), b: Uint32Array.from(b) };
}

export function crambinStructure() {
  const count = EL.length;
  const residueCount = RESNAME.length;

  // Original Angstrom coordinates, NOT recentred. Framing is the camera's job,
  // derived from coordinateBounds() — see ex/adapter.mjs.
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) positions[i] = XYZ[i] / 100;

  const element = new Uint8Array(count);
  const radius = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    element[i] = ATOMIC_NUMBER[ELS[EL[i]]];
    radius[i] = VDW[EL[i]];
  }

  const { a, b } = inferBonds(positions, count);

  return createStructure({
    positions,
    topology: {
      atoms: {
        count,
        id: Array.from({ length: count }, (_, i) => String(i + 1)),
        name: atomNames(count),
        altloc: new Array(count).fill(''),
        residue: Uint32Array.from(RES),
        element,
        occupancy: new Float32Array(count).fill(1),
        bfactor: new Float32Array(count),
        radius,
      },
      residues: {
        count: residueCount,
        chain: new Uint32Array(residueCount),            // single chain
        labelSeq: Int32Array.from(RESSEQ),
        authSeq: Array.from(RESSEQ, String),
        insertionCode: new Array(residueCount).fill(''),
        comp: [...RESNAME],
        polymer: new Array(residueCount).fill('protein'),
      },
      chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
      bonds: {
        count: a.length, a, b,
        order: new Uint8Array(a.length).fill(1),
        source: new Array(a.length).fill('inferred'),
      },
      instances: {
        count: 1, chain: Uint32Array.of(0), operatorId: ['1'],
        transform: Float64Array.of(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1),
      },
    },
  });
}

/** Presentation field, deliberately not a required chemical column. */
export function elementColors(data) {
  const { atoms } = data.topology;
  const byNumber = { 6: 0, 7: 1, 8: 2, 16: 3, 15: 4 };
  const colors = new Float32Array(atoms.count * 4);
  for (let i = 0; i < atoms.count; i++) {
    colors.set(ELEMENT_COLOR[byNumber[atoms.element[i]]] ?? ELEMENT_COLOR[0], i * 4);
  }
  return colors;
}
