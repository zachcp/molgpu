// A minimal indexed-mesh accumulator for the cartoon builders: positions,
// unit normals, triangles and one source residue row per vertex (Mol*'s
// MeshBuilder "group"). Plain arrays while building, owned typed arrays out.

type Vec3 = readonly [number, number, number];

/** Owned mesh arrays with each vertex's source residue row. */
export interface MeshParts {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly residue: Uint32Array;
}

export interface MeshBuilder {
  /** Residue row recorded for vertices added from now on. */
  group: number;
  vertexCount(): number;
  vertex(position: Vec3, normal: Vec3): void;
  triangle(a: number, b: number, c: number): void;
  finish(): MeshParts;
}

export function meshBuilder(): MeshBuilder {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const residue: number[] = [];
  return {
    group: 0,
    vertexCount: () => residue.length,
    vertex(p, n) {
      const l = Math.hypot(n[0], n[1], n[2]);
      positions.push(p[0], p[1], p[2]);
      if (l > 1e-12) normals.push(n[0] / l, n[1] / l, n[2] / l);
      else normals.push(0, 0, 1);
      residue.push(this.group);
    },
    triangle(a, b, c) {
      indices.push(a, b, c);
    },
    finish: () => ({
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      indices: Uint32Array.from(indices),
      residue: Uint32Array.from(residue),
    }),
  };
}

/** Concatenate meshes, offsetting each part's indices. */
export function concatMeshes(parts: readonly MeshParts[]): MeshParts {
  const total = (key: keyof MeshParts) =>
    parts.reduce((sum, part) => sum + part[key].length, 0);
  const positions = new Float32Array(total("positions"));
  const normals = new Float32Array(total("normals"));
  const indices = new Uint32Array(total("indices"));
  const residue = new Uint32Array(total("residue"));
  let v = 0, t = 0;
  for (const part of parts) {
    positions.set(part.positions, v * 3);
    normals.set(part.normals, v * 3);
    residue.set(part.residue, v);
    for (let i = 0; i < part.indices.length; i++) {
      indices[t + i] = part.indices[i] + v;
    }
    v += part.residue.length;
    t += part.indices.length;
  }
  return { positions, normals, indices, residue };
}
