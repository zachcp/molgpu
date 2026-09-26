import { coordinateBounds, type StructureData } from "@molgpu/table";
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
