// Raw Mol* CIF access for oracle tests: read categories directly, independently
// of @molgpu/io's own lowering.
import { CIF, type CifCategory } from 'molstar/lib/mol-io/reader/cif.js';

export type { CifCategory };

const clean = (value: string) => value === '.' || value === '?' ? '' : value;
export const str = (category: CifCategory, name: string, row: number, fallback = ''): string =>
  clean(category.getField(name)?.str(row) ?? fallback);
export const num = (category: CifCategory, name: string, row: number, fallback = 0): number =>
  category.getField(name)?.float(row) ?? fallback;

/** The first data block's categories; throws if Mol* cannot parse the bytes. */
export async function cifCategories(bytes: Uint8Array): Promise<{ [name: string]: CifCategory }> {
  const parsed = await CIF.parseBinary(bytes).run();
  if (parsed.isError) throw new Error(`Mol* could not parse the fixture: ${parsed}`);
  return parsed.result.blocks[0].categories;
}
