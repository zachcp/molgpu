// Can a cartoon-style tube come for free from LineLayer, with NO mesh build?
// RawLines imports @use-gpu/wgsl/geometry/tube and sets
// LINE_STRIP_DETAIL = sides when shaded, so the extrusion is done on the GPU.
//   ?sides=8&width=1.2
import { use, useMemo } from '@use-gpu/live';
import { LineLayer, useRawSource } from '@use-gpu/workbench';
import { Structure, computeBounds, useStructure } from '../lib/structure.mjs';
import { crambinTable } from '../lib/table.mjs';

export const title = 'LineLayer tube — GPU-extruded worm';

const table = crambinTable();
const bounds = computeBounds(table);
export const camera = { radius: bounds.extent * 1.8, target: bounds.center };

// Working config: depth:-1 (absolute/world sizing) with a SMALL width.
// width >= ~3 at depth:-1 renders nothing, with no error — sizing semantics here
// are finicky and undocumented; see the findings doc.
const Tube = ({ sides = 8, width = 1.2, depth = -1 }) => {
  const { table } = useStructure();
  const built = useMemo(() => {
    // Stand-in for a real backbone trace: every 4th heavy atom.
    const idx = [];
    for (let i = 0; i < table.count; i += 4) idx.push(i);
    const positions = new Float32Array(idx.length * 3);
    const widths = new Float32Array(idx.length);
    idx.forEach((i, k) => {
      positions[k*3]   = table.positions[i*3];
      positions[k*3+1] = table.positions[i*3+1];
      positions[k*3+2] = table.positions[i*3+2];
      // per-point width, as a bound field — tapers like a real ribbon would
      widths[k] = width * (0.5 + 0.5 * Math.sin(k * 0.4));
    });
    return { positions, widths };
  }, [table, width]);

  const positions = useRawSource(built.positions, 'vec3<f32>');
  const widths = useRawSource(built.widths, 'f32');

  return use(LineLayer, {
    positions, widths,
    segment: 0,          // one continuous run
    shaded: true,        // + sides > 0 => GPU tube extrusion
    sides,
    join: 'round',
    ...(depth !== null ? { depth } : {}),
    color: [0.45, 0.78, 0.95, 1],
  });
};

export function body() {
  const q = new URLSearchParams(location.search);
  return use(Structure, { table, children:
    use(Tube, { sides: parseInt(q.get('sides') ?? '8', 10),
                width: parseFloat(q.get('width') ?? '1.2'),
                depth: q.get('depth') != null ? parseFloat(q.get('depth')) : -1 }) });
}
