// S3 step 3: feed the lifted Mol* scalar field to use.gpu's DualContourLayer.
import { render, use } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import {
  OrbitCamera, Pass, RawData, DualContourLayer,
  AmbientLight, DirectionalLight, PBRMaterial,
} from '@use-gpu/workbench';
import { parsePDBText } from './pdb.mjs';
import { molecularSurfaceField } from './lift.mjs';

const hud = (s) => { document.getElementById('hud').textContent = s; };
const qs = new URLSearchParams(location.search);
const STRUCT = qs.get('s') ?? '1crn';
const RES = parseFloat(qs.get('res') ?? '0.5');
const CLAMP = qs.get('clamp') !== '0';   // clamp the -1001 sentinel; ?clamp=0 to compare

const t0 = performance.now();
const text = await (await fetch(`./data/${STRUCT}.pdb`)).text();
const atoms = parsePDBText(text);
const tParse = performance.now() - t0;

const t1 = performance.now();
const f = await molecularSurfaceField(atoms, { resolution: RES });
const tField = performance.now() - t1;

// The kernel fills unvisited cells with -1001 (a sentinel, not a distance). That is
// harmless for marching cubes, which only interpolates across the isolevel crossing,
// but dual contouring estimates normals from the gradient, so the cliff between
// visited and unvisited cells can produce artifacts. Clamp it to a sane band.
const values = Float32Array.from(f.values);
if (CLAMP) {
  const lo = f.level - 2;
  for (let i = 0; i < values.length; i++) if (values[i] < lo) values[i] = lo;
}

// `transform` maps grid space -> world. It is a scale+translate, so read the
// diagonal and translation straight off the Mat4 (column-major).
const m = f.transform;
const [sx, sy, sz] = [m[0], m[5], m[10]];
const [tx, ty, tz] = [m[12], m[13], m[14]];
const [nx, ny, nz] = f.dims;
const range = [
  [tx, tx + (nx - 1) * sx],
  [ty, ty + (ny - 1) * sy],
  [tz, tz + (nz - 1) * sz],
];
const center = range.map(([a, b]) => (a + b) / 2);
const extent = Math.max(...range.map(([a, b]) => b - a));

hud([
  `${STRUCT}  ${atoms.count} heavy atoms`,
  `resolution ${RES} A   grid ${nx}x${ny}x${nz}  (${(nx*ny*nz/1e6).toFixed(2)}M cells)`,
  `parse ${tParse.toFixed(0)}ms   field ${tField.toFixed(0)}ms`,
  `isolevel ${f.level}   sentinel ${CLAMP ? 'clamped' : 'RAW'}`,
  `field ${(values.byteLength/1048576).toFixed(1)}MB`,
].join('\n'));

const Scene = () =>
  use(OrbitCamera, {
    bearing: 0.6, pitch: 0.4, radius: extent * 1.6, target: center,
    children: use(Pass, {
      children: [
        use(AmbientLight, { color: [1, 1, 1], intensity: 0.15 }),
        use(DirectionalLight, { position: [1, 2, 1.5], color: [1, 1, 1], intensity: 1.0 }),
        use(PBRMaterial, {
          metalness: 0.1, roughness: 0.45,
          children: use(RawData, {
            data: values, format: 'f32',
            render: (source) => use(DualContourLayer, {
              values: source,
              size: [nx, ny, nz],
              range,
              level: f.level,
              method: 'linear',
              color: [0.55, 0.72, 0.92, 1],
              shaded: true,
            }),
          }),
        }),
      ],
    }),
  });

render(
  use(WebGPU, {
    fallback: (e) => { hud('WebGPU unavailable: ' + (e?.message ?? e)); return null; },
    children: use(AutoCanvas, {
      selector: '#root', samples: 4, backgroundColor: [0.08, 0.09, 0.11, 1],
      children: use(Scene),
    }),
  }),
);
