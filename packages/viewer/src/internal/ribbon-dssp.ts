import { activeAtoms, type StructureData } from "@molgpu/table";

/**
 * DSSP input rows for a ribbon that draws `rows`: every active (primary
 * altloc) atom of each model those rows touch. Each model is assigned from its
 * own complete coordinates, so a selection of model 2, of several models, or
 * of part of a chain gets the codes its whole model would have. Topology only.
 */
export function ribbonDsspRows(
  data: StructureData,
  rows: ArrayLike<number>,
): Uint32Array {
  const { atoms, residues, chains } = data.topology;
  const modelOf = (row: number) =>
    chains.model[residues.chain[atoms.residue[row]]];
  const models = new Set<number>();
  for (let k = 0; k < rows.length; k++) models.add(modelOf(rows[k]));
  return activeAtoms(data, { model: "all" }).filter((row) =>
    models.has(modelOf(row))
  );
}
