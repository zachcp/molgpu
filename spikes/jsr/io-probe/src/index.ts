// Probe: keep Mol* optional under JSR by importing it through a computed specifier.
const MOLSTAR = 'molstar';
/** Loads Mol*'s CIF reader from the consumer's own install. */
export async function loadCifReader(): Promise<unknown> {
  const { CIF } = await import(`${MOLSTAR}/lib/mol-io/reader/cif.js`);
  return CIF;
}
