// Probe: the real @molgpu/io module (Mol* dynamic deep imports) under Deno.
import { structureFromBcif, molecularSurfaceField } from '../../../packages/io/src/index.mjs';
const bytes = await Deno.readFile(new URL('../../../packages/io/test/fixtures/1crn.bcif', import.meta.url));
const data = await structureFromBcif(bytes);
console.log('atoms', data.topology.atoms.count, 'residues', data.topology.residues.count);
const n = data.topology.atoms.count, P = data.positions;
const pick = (k: number) => Float32Array.from({ length: n }, (_, i) => P[i * 3 + k]);
const atoms = { count: n, x: pick(0), y: pick(1), z: pick(2), radius: new Float32Array(n).fill(1.7) };
const field = await molecularSurfaceField(atoms, { probeRadius: 1.4, resolution: 1 });
console.log('surface field', field.dims ?? field.size ?? Object.keys(field), 'values', field.values?.length);
