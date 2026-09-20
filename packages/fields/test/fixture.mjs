import { createStructure } from '@molgpu/table';

// 4 atoms across 2 residues, with distinct elements and a graded B-factor so
// attribute/linear/colormap fields have something to bite on.
//   atom     0    1    2    3
//   element  C    N    O    S    (6, 7, 8, 16)
//   bfactor  10   20   30   40
//   residue  0    0    1    1
export function fixture() {
  return {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]),
    topology: {
      atoms: {
        count: 4, id: ['1', '2', '3', '4'], name: ['C', 'N', 'O', 'S'],
        altloc: ['', '', '', ''], residue: Uint32Array.from([0, 0, 1, 1]),
        element: Uint8Array.from([6, 7, 8, 16]),
        occupancy: Float32Array.from([1, 1, 1, 1]), bfactor: Float32Array.from([10, 20, 30, 40]),
        radius: Float32Array.from([1.7, 1.55, 1.52, 1.8]),
      },
      residues: {
        count: 2, chain: Uint32Array.from([0, 0]), labelSeq: Int32Array.from([1, 2]),
        authSeq: ['1', '2'], insertionCode: ['', ''], comp: ['ALA', 'CYS'], polymer: ['protein', 'protein'],
      },
      chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
      bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
      instances: { count: 1, chain: Uint32Array.of(0), operatorId: ['1'], transform: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) },
    },
  };
}

export const structure = () => createStructure(fixture());
