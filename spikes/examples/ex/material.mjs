// PBRMaterial + lights. The material is a CONTEXT PROVIDER: it wraps the layers
// it applies to rather than being a prop on them. That is the pattern to copy
// for any appearance state in use.gpu.
import { use } from '@use-gpu/live';
import { GeometryData, FaceLayer, PBRMaterial, makeSphereGeometry } from '@use-gpu/workbench';

export const title = 'PBRMaterial — roughness ramp';
export const camera = { radius: 5 };

/** FaceLayer has no transform prop, so bake the offset into the geometry. */
function sphereAt(base, dx) {
  const p = Float32Array.from(base.attributes.positions);   // vec4 stride
  for (let i = 0; i < p.length; i += 4) p[i] += dx;
  return { ...base, attributes: { ...base.attributes, positions: p } };
}

export function body() {
  const base = makeSphereGeometry({ detail: [24, 48] });

  // Unit-diameter spheres, so 1.4 apart leaves a clear gap.
  return [0.05, 0.3, 0.75].map((roughness, i) =>
    use(PBRMaterial, {
      metalness: 0.9, roughness,
      children: use(GeometryData, {
        ...sphereAt(base, (i - 1) * 1.4),
        render: (mesh) => use(FaceLayer, {
          mesh, shaded: true, side: 'both', color: [0.75, 0.80, 0.88, 1],
        }),
      }),
    }));
}
