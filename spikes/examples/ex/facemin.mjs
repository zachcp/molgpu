// Isolation for FaceLayer. ?v=tri | mesh | both | flat | noshade
import { use } from '@use-gpu/live';
import { RawData, GeometryData, FaceLayer, makeSphereGeometry } from '@use-gpu/workbench';

export const title = 'FaceLayer isolation';
export const camera = { radius: 5 };

export function body() {
  const v = new URLSearchParams(location.search).get('v') ?? 'tri';

  if (v === 'tri') {
    // Hand-built triangle, no mesh: does FaceLayer draw at all?
    const positions = Float32Array.from([-1.5,-1,0,  1.5,-1,0,  0,1.5,0]);
    return use(RawData, { data: positions, format: 'vec3<f32>', render: (p) =>
      use(FaceLayer, { positions: p, count: 3, color: [0.9,0.6,0.35,1], side: 'both' }) });
  }

  const sphere = makeSphereGeometry({ detail: [24, 48] });
  // dump what we actually got, so the numbers are visible not assumed
  window.__geo = { count: sphere.count, topology: sphere.topology, formats: sphere.formats,
    lens: Object.fromEntries(Object.entries(sphere.attributes).map(([k,a])=>[k,a?.length])),
    bounds: sphere.bounds,
    xRange: (() => { const p = sphere.attributes.positions; let mn=1e9,mx=-1e9;
      for (let i=0;i<p.length;i+=4){ if(p[i]<mn)mn=p[i]; if(p[i]>mx)mx=p[i]; } return [mn,mx]; })() };

  const flags =
    v === 'both'    ? { side: 'both' } :
    v === 'flat'    ? { flat: true, side: 'both' } :
    v === 'noshade' ? { shaded: false, side: 'both' } :
    {};

  return use(GeometryData, { ...sphere,
    render: (mesh) => use(FaceLayer, { mesh, color: [0.62,0.76,0.93,1], shaded: true, ...flags }) });
}
