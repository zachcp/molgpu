// One symmetric sphere makes camera movement and light movement distinguishable:
// orbiting preserves the silhouette, while a world-fixed key light moves its
// bright side across the image. Drag the canvas to inspect it.
import { use } from '@use-gpu/live';
import { createStructure } from '@molgpu/table';
import { Structure, Spacefill } from '@molgpu/viewer';

export const title = 'World-space lighting — orbit the camera';
export const camera = { radius: 7, target: [0, 0, 0], bearing: 0, pitch: 0 };

const data = createStructure({
  positions: Float32Array.of(0, 0, 0),
  topology: {
    atoms: { count: 1, id: ['1'], name: ['C'], altloc: [''], residue: Uint32Array.of(0),
      element: Uint8Array.of(6), occupancy: Float32Array.of(1), bfactor: Float32Array.of(0), radius: Float32Array.of(1.7) },
    residues: { count: 1, chain: Uint32Array.of(0), labelSeq: Int32Array.of(1), authSeq: ['1'], insertionCode: [''], comp: ['GLY'], polymer: ['protein'] },
    chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
    bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: 1, chain: Uint32Array.of(0), operatorId: ['1'], transform: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) },
  },
});

export function body() {
  return use(Structure, { data, children: use(Spacefill, { color: [0.82, 0.82, 0.82, 1] }) });
}
