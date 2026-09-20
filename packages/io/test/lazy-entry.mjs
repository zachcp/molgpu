/** Browser boundary: applications import this entry, then fetch their BCIF. */
export async function loadBcifStructure(bytes) {
  const { structureFromBcif } = await import('../src/index.mjs');
  return structureFromBcif(bytes);
}
