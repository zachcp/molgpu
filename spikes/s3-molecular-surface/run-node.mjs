// S3 step 1+2: does the kernel lift, and is it fast enough? Pure CPU, no browser.
import { parsePDB } from './pdb.mjs';
import { molecularSurfaceField } from './lift.mjs';

const RESOLUTIONS = [1.0, 0.75, 0.5, 0.35, 0.25];

for (const file of ['1crn', '1tqn']) {
  const atoms = await parsePDB(new URL(`./data/${file}.pdb`, import.meta.url).pathname);
  console.log(`\n=== ${file}: ${atoms.count} heavy atoms ===`);
  console.log('res    dims              cells      ms     MB    finite%  range');
  for (const resolution of RESOLUTIONS) {
    const t0 = performance.now();
    let f;
    try { f = await molecularSurfaceField(atoms, { resolution }); }
    catch (e) { console.log(`${resolution.toFixed(2)}   FAILED: ${e.message}`); continue; }
    const ms = performance.now() - t0;
    const cells = f.dims[0] * f.dims[1] * f.dims[2];
    let min = Infinity, max = -Infinity, finite = 0;
    for (let i = 0; i < f.values.length; i++) {
      const v = f.values[i];
      if (Number.isFinite(v)) { finite++; if (v < min) min = v; if (v > max) max = v; }
    }
    console.log(
      `${resolution.toFixed(2)}   ${f.dims.join('x').padEnd(16)}  ${String(cells).padEnd(9)}  ` +
      `${ms.toFixed(0).padStart(5)}  ${(f.values.byteLength / 1048576).toFixed(1).padStart(5)}  ` +
      `${((finite / f.values.length) * 100).toFixed(0).padStart(6)}%  ` +
      `[${min.toFixed(2)}, ${max.toFixed(2)}]  level=${f.level}`,
    );
  }
}
