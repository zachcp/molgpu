// The new packages, running on real data.
//
//   @molgpu/table   -> validated StructureData (atoms/residues/chains/bonds/instances)
//   @molgpu/viewer  -> ColumnSource, the internal GPU column adapter
//
// What is different from ?ex=structure (the older hand-rolled version):
//
//  1. The table is VALIDATED. createStructure() checks foreign keys, duplicate
//     sites, cross-model bonds and affine transforms. A malformed fixture throws
//     here instead of rendering something subtly wrong.
//  2. Framing comes from coordinateBounds(), not a magic radius, and the
//     coordinates stay in original Angstroms.
//  3. Columns go to the GPU through ColumnSource, which wraps the RawData
//     COMPONENT. That is what makes `?src=hook` below fail and this path work.
//
//   ?rep=both | spacefill | bonds
//   ?src=adapter | hook         (hook = useRawSource, the broken vec3 path)
import { use, useMemo } from '@use-gpu/live';
import { PointLayer, LineLayer, useRawSource } from '@use-gpu/workbench';
import { activeAtoms, coordinateBounds } from '@molgpu/table';
import { ColumnSource } from '@molgpu/viewer/src/internal/column-source.mjs';
import { crambinStructure, elementColors } from '../lib/crambin-structure.mjs';

export const title = '@molgpu/table + ColumnSource — crambin';

const data = crambinStructure();
const active = activeAtoms(data);                  // model/altloc policy, from the table package
const bounds = coordinateBounds(data, active);

// Camera derives from the structure's own coordinate bounds. Because positions
// are NOT recentred, the target is the real centroid in Angstroms.
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.6, target: bounds.center };

// At depth:1 PointLayer `sizes` is world-space but not raw Angstrom. This factor
// depends on fov and viewport and MUST be derived in real code (bead
// molgpu-sept-jy6.5); hardcoded because the harness camera is fixed.
const A_TO_SIZE = 296;

// The diagnostic control. useRawSource uploads array.buffer verbatim, with no
// vec3->vec4 GPU padding, so every position after the first is read at the wrong
// stride. Identical data, identical props -- see ?src=hook.
const HookSource = ({ data, format, render }) => render(useRawSource(data, format));

/** Fold a column list into nested sources, so scene code is not a pyramid. */
const withColumns = (Source, specs, render) => {
  const step = (i, bound) => i === specs.length
    ? render(bound)
    : use(Source, { data: specs[i].data, format: specs[i].format,
        render: (source) => step(i + 1, { ...bound, [specs[i].name]: source }) });
  return step(0, {});
};

export function body() {
  const q = new URLSearchParams(location.search);
  const rep = q.get('rep') ?? 'both';
  const Source = q.get('src') === 'hook' ? HookSource : ColumnSource;
  const scale = parseFloat(q.get('scale') ?? (rep === 'spacefill' ? '1' : '0.3'));
  const stick = parseFloat(q.get('stick') ?? '0.5');

  const { atoms, bonds } = data.topology;
  const colors = elementColors(data);

  // --- spacefill: one row per atom, columns used as-is -----------------------
  const spacefill = () => {
    const sizes = new Float32Array(atoms.count);
    for (let i = 0; i < atoms.count; i++) sizes[i] = atoms.radius[i] * scale * A_TO_SIZE;
    return withColumns(Source, [
      { name: 'positions', data: data.positions, format: 'vec3<f32>' },
      { name: 'colors',    data: colors,         format: 'vec4<f32>' },
      { name: 'sizes',     data: sizes,          format: 'f32' },
    ], ({ positions, colors, sizes }) => positions && use(PointLayer, {
      positions, colors, sizes, count: atoms.count,
      shape: 'circle', shaded: true, depth: 1,
    }));
  };

  // --- bonds: gathered to one row per endpoint ------------------------------
  // Indirect draw (leaving the atom buffers bound and passing an index buffer)
  // is broken in use.gpu 0.20.0 -- bead molgpu-sept-cqm.10 -- so this compacts.
  const bondLines = () => {
    const n = bonds.count * 2;
    const positions = new Float32Array(n * 3);
    const lineColors = new Float32Array(n * 4);
    const segments = new Int32Array(n);
    for (let k = 0; k < bonds.count; k++) {
      for (const [slot, atom] of [[0, bonds.a[k]], [1, bonds.b[k]]]) {
        const w = k * 2 + slot;
        positions[w*3]   = data.positions[atom*3];
        positions[w*3+1] = data.positions[atom*3+1];
        positions[w*3+2] = data.positions[atom*3+2];
        lineColors.set(colors.subarray(atom*4, atom*4 + 4), w*4);
        segments[w] = slot === 0 ? 1 : 2;      // start, end, start, end, ...
      }
    }
    return withColumns(Source, [
      { name: 'positions', data: positions,  format: 'vec3<f32>' },
      { name: 'colors',    data: lineColors, format: 'vec4<f32>' },
      { name: 'segments',  data: segments,   format: 'i32' },
    ], ({ positions, colors, segments }) => positions && use(LineLayer, {
      // NOTE: no `count`. RawLines calls useDataLength(count, positions, -1) and
      // applies that -1 even when count is passed, so an explicit count silently
      // drops the last segment. Let it derive from the source.
      //
      // `shaded + sides + depth:-1` is the world-space shaded-tube convention
      // (same as lib/bonds.mjs); plain `width` alone is pixels.
      positions, colors, segments, width: stick,
      join: 'round', shaded: true, sides: 6, depth: -1,
    }));
  };

  if (rep === 'spacefill') return spacefill();
  if (rep === 'bonds') return bondLines();
  return [spacefill(), bondLines()];
}
