// Synthetic BinaryCIF for tests: a single atom_site block written with Mol*'s
// CifWriter, so a fixture can carry values no corpus entry has.
import { CifWriter } from "molstar/lib/mol-io/writer/cif.js";

/** One atom_site row; `charge` null writes '?'. */
export interface AtomRow {
  readonly element: string;
  readonly name: string;
  readonly comp: string;
  readonly seq: number;
  readonly chain?: string;
  readonly group?: "ATOM" | "HETATM";
  readonly xyz: readonly [number, number, number];
  readonly charge?: number | null;
}

/** Extra string-valued categories, e.g. struct_conf rows. */
export type ExtraCategories = Readonly<
  Record<string, readonly Readonly<Record<string, string | number>>[]>
>;

/**
 * Encode `rows` as BCIF; `charge: false` omits pdbx_formal_charge, and
 * `categories` adds more categories (every field written as a string).
 */
export function atomSiteBcif(
  rows: readonly AtomRow[],
  options: {
    readonly charge?: boolean;
    readonly categories?: ExtraCategories;
  } = {},
): Uint8Array {
  const F = CifWriter.fields<number, readonly AtomRow[]>()
    .int("id", (i) => i + 1)
    .str("group_PDB", (i, d) => d[i].group ?? "ATOM")
    .str("type_symbol", (i, d) => d[i].element)
    .str("label_atom_id", (i, d) => d[i].name)
    .str("label_comp_id", (i, d) => d[i].comp)
    .str("label_asym_id", (i, d) => d[i].chain ?? "A")
    .str("auth_asym_id", (i, d) => d[i].chain ?? "A")
    .int("label_seq_id", (i, d) => d[i].seq)
    .str("auth_seq_id", (i, d) => String(d[i].seq))
    .float("Cartn_x", (i, d) => d[i].xyz[0])
    .float("Cartn_y", (i, d) => d[i].xyz[1])
    .float("Cartn_z", (i, d) => d[i].xyz[2])
    .float("occupancy", () => 1)
    .float("B_iso_or_equiv", () => 0)
    .int("pdbx_PDB_model_num", () => 1);
  if (options.charge !== false) {
    F.int("pdbx_formal_charge", (i, d) => d[i].charge ?? 0, {
      // 0 present, 2 unknown ('?').
      valueKind: (i, d) => d[i].charge == null ? 2 : 0,
    });
  }
  const fields = F.getFields();
  const encoder = CifWriter.createEncoder({ binary: true });
  encoder.startDataBlock("test");
  encoder.writeCategory({
    name: "atom_site",
    instance: () =>
      CifWriter.categoryInstance(fields, { data: rows, rowCount: rows.length }),
  });
  for (const [name, catRows] of Object.entries(options.categories ?? {})) {
    const builder = CifWriter.fields<number, typeof catRows>();
    for (const field of Object.keys(catRows[0] ?? {})) {
      builder.str(field, (i, d) => String(d[i][field]), {
        // Encode CIF's missing/unknown markers as value kinds, so Mol*'s
        // schema reader exercises the same fallback behavior as real inputs.
        valueKind: (i, d) =>
          d[i][field] === "." ? 1 : d[i][field] === "?" ? 2 : 0,
      });
    }
    const catFields = builder.getFields();
    encoder.writeCategory({
      name,
      instance: () =>
        CifWriter.categoryInstance(catFields, {
          data: catRows,
          rowCount: catRows.length,
        }),
    });
  }
  encoder.encode();
  return encoder.getData() as Uint8Array;
}
