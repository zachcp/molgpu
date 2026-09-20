export function fixture() {
  return { positions: Float32Array.from([0,0,0, 1,2,3, 2,3,4, 3,4,5, 4,5,6, 5,6,7]), topology: {
    atoms: { count: 6, id: ['1','2','3','4','5','6'], name: ['N','CA','CA','CA','CA','CA'],
      altloc: ['','A','B','','',''], residue: Uint32Array.from([0,0,0,1,2,3]),
      element: Uint8Array.from([7,6,6,6,6,6]), occupancy: Float32Array.from([1,.4,.6,1,1,1]), bfactor: new Float32Array(6) },
    residues: { count: 4, chain: Uint32Array.from([0,0,1,2]), labelSeq: Int32Array.from([1,2,1,1]),
      authSeq: ['42','42','42','42'], insertionCode: ['','A','',''], comp: ['ALA','GLY','ALA','ALA'], polymer: ['protein','protein','protein','protein'] },
    chains: { count: 3, model: Int32Array.from([1,1,2]), labelId: ['A','B','A'], authId: ['X','Y','X'] },
    bonds: { count: 1, a: Uint32Array.from([0]), b: Uint32Array.from([2]), order: Uint8Array.from([1]), source: ['explicit'] },
    instances: { count: 2, chain: Uint32Array.from([0,0]), operatorId: ['identity','translate'],
      transform: Float64Array.from([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1, 1,0,0,0, 0,1,0,0, 0,0,1,0, 10,0,0,1]) },
  } };
}
