// Minimal PDB ATOM/HETATM parser. Deliberately dependency-free so S3 does not
// depend on S4's mol-io lowering. Works in Node and the browser. Throwaway spike code.

// VdW radii (Angstrom), enough elements for the test structures.
const VDW = { H: 1.1, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, FE: 2.05, SE: 1.9 };

export function parsePDBText(text, { hetatm = true } = {}) {
  const x = [], y = [], z = [], radius = [], id = [], element = [];
  for (const line of text.split('\n')) {
    const rec = line.slice(0, 6);
    if (rec !== 'ATOM  ' && !(hetatm && rec === 'HETATM')) continue;
    // Element is cols 77-78; fall back to the atom-name heuristic when absent.
    let el = line.slice(76, 78).trim().toUpperCase();
    if (!el) el = line.slice(12, 16).trim().replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase();
    if (el === 'H' || el === 'D') continue;              // heavy atoms only, as surfaces normally are
    x.push(parseFloat(line.slice(30, 38)));
    y.push(parseFloat(line.slice(38, 46)));
    z.push(parseFloat(line.slice(46, 54)));
    radius.push(VDW[el] ?? 1.7);
    element.push(el);
    id.push(id.length);
  }
  return {
    x: Float32Array.from(x), y: Float32Array.from(y), z: Float32Array.from(z),
    radius: Float32Array.from(radius), id: Int32Array.from(id),
    element, count: x.length,
  };
}

export async function parsePDB(path, opts) {
  const { readFileSync } = await import('node:fs');
  return parsePDBText(readFileSync(path, 'utf8'), opts);
}
