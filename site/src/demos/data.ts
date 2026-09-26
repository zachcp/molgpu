import {
  coordinateBounds,
  createVolume,
  type StructureData,
  type VolumeData,
} from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";

export const cameraFor = (data: StructureData, scale = 1.7) => {
  const bounds = coordinateBounds(data);
  if (!bounds) {
    return { radius: 7, target: [0, 0, 0] as [number, number, number] };
  }
  const extent = Math.max(
    ...bounds.max.map((value, index) => value - bounds.min[index]),
  );
  return {
    radius: Math.max(7, extent * scale),
    target: bounds.center as [number, number, number],
  };
};

let crambin: Promise<StructureData> | undefined;

/** Lazily load the real annotated 1CRN structure only for geometry-sensitive demos. */
export const loadCrambin = (url: string): Promise<StructureData> => {
  crambin ??= fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load 1CRN (${response.status})`);
    }
    return structureFromBcif(new Uint8Array(await response.arrayBuffer()));
  });
  return crambin;
};

const densityMaps = new WeakMap<StructureData, VolumeData>();

/**
 * A Gaussian atom-density map built from the structure itself: each atom adds
 * `exp(-r² / 2σ²)` (σ = 1.4 Å) on a 0.8 Å grid padded by 5 Å. Sampled at the
 * atoms it reads as local packing, so buried atoms score higher than exposed
 * ones. Built once per structure.
 */
export const densityMapFor = (data: StructureData): VolumeData => {
  const hit = densityMaps.get(data);
  if (hit) return hit;
  const bounds = coordinateBounds(data);
  if (!bounds) throw new Error("density map needs atom coordinates");
  const spacing = 0.8, pad = 5, sigma = 1.4, cutoff = 3 * sigma;
  const origin = bounds.min.map((value) => value - pad);
  const dims = bounds.max.map((value, axis) =>
    Math.ceil((value + pad - origin[axis]) / spacing) + 1
  ) as [number, number, number];
  const [nx, ny, nz] = dims;
  const values = new Float32Array(nx * ny * nz);
  const { positions } = data;
  const reach = Math.ceil(cutoff / spacing);
  for (let atom = 0; atom < positions.length / 3; atom++) {
    const x = positions[atom * 3],
      y = positions[atom * 3 + 1],
      z = positions[atom * 3 + 2];
    const ci = Math.round((x - origin[0]) / spacing),
      cj = Math.round((y - origin[1]) / spacing),
      ck = Math.round((z - origin[2]) / spacing);
    for (
      let k = Math.max(0, ck - reach);
      k <= Math.min(nz - 1, ck + reach);
      k++
    ) {
      const dz = origin[2] + k * spacing - z;
      for (
        let j = Math.max(0, cj - reach);
        j <= Math.min(ny - 1, cj + reach);
        j++
      ) {
        const dy = origin[1] + j * spacing - y;
        for (
          let i = Math.max(0, ci - reach);
          i <= Math.min(nx - 1, ci + reach);
          i++
        ) {
          const dx = origin[0] + i * spacing - x;
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 > cutoff * cutoff) continue;
          values[i + nx * (j + ny * k)] += Math.exp(-r2 / (2 * sigma * sigma));
        }
      }
    }
  }
  const volume = createVolume({
    values,
    dims,
    transform: [
      ...[spacing, 0, 0, 0],
      ...[0, spacing, 0, 0],
      ...[0, 0, spacing, 0],
      ...[origin[0], origin[1], origin[2], 1],
    ],
  });
  densityMaps.set(data, volume);
  return volume;
};
