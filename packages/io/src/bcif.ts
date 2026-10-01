import {
  atomicNumberForSymbol,
  createStructure,
  elementRadius,
  type Links,
  type StructureData,
  withAttributes,
} from "@molgpu/table";
import type { CifFrame } from "molstar/lib/mol-io/reader/cif.js";
import { errorFor, IoError } from "./error.ts";
import { type FileInput, readInput } from "./input.ts";
import { polymerKind } from "./residues.ts";

const bcifError = errorFor("bcif");

/** The slice of a Mol* CIF category this module reads. */
interface CifCategory {
  readonly rowCount: number;
  getField(
    name: string,
  ): {
    str(row: number): string;
    float(row: number): number;
    /** Mol* Column.ValueKind: 0 present, 1 not present ('.'), 2 unknown ('?'). */
    valueKind(row: number): number;
  } | undefined;
}
type Categories = Readonly<Record<string, CifCategory | undefined>>;
type PolymerKind = "protein" | "rna" | "dna" | "other";
interface ResidueRow {
  chain: number;
  seq: number;
  authSeq: string;
  insertion: string;
  comp: string;
  het: number;
}
interface ChainRow {
  model: number;
  entityId: string;
  labelId: string;
  authId: string;
}

const clean = (value: string): string =>
  value === "." || value === "?" ? "" : value;
const field = (category: CifCategory, name: string) => category.getField(name);
const str = (
  category: CifCategory,
  name: string,
  row: number,
  fallback = "",
): string => clean(field(category, name)?.str(row) ?? fallback);
const num = (
  category: CifCategory,
  name: string,
  row: number,
  fallback = 0,
): number => field(category, name)?.float(row) ?? fallback;

async function parseBcif(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<{ blocks: readonly (CifFrame & { categories: Categories })[] }> {
  if (!(bytes instanceof Uint8Array)) {
    throw bcifError(
      "BCIF input must be a Uint8Array",
      "INVALID_INPUT",
    );
  }
  try {
    // Keep the sole Mol* dependency behind the call boundary: consumers that
    // only use @molgpu/table never load this parser or its transitive chunks.
    const { CIF } = await import("molstar/lib/mol-io/reader/cif.js");
    signal?.throwIfAborted();
    const parsed = await CIF.parseBinary(bytes).run((progress) => {
      if (signal?.aborted) progress.requestAbort("request cancelled");
    });
    signal?.throwIfAborted();
    if (parsed.isError) {
      throw bcifError(parsed.message, "INVALID_BCIF");
    }
    return parsed.result as unknown as {
      blocks: readonly (CifFrame & { categories: Categories })[];
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof IoError) throw error;
    throw bcifError(
      "Unable to load the optional Mol* BCIF parser",
      "PARSER_UNAVAILABLE",
      error,
    );
  }
}

/** Lower Mol*'s component-bond templates and resolved struct_conn entries. */
function readLinks(
  semantics: MmcifSemantics | undefined,
  atoms: {
    readonly name: readonly string[];
    readonly altloc: readonly string[];
    readonly comp: readonly string[];
    readonly element: Uint8Array;
    readonly residue: Uint32Array;
  },
  residues: readonly ResidueRow[],
): Links | undefined {
  if (!semantics) return undefined;
  const a: number[] = [], b: number[] = [], order: number[] = [];
  const flags: number[] = [], source: ("component" | "struct_conn")[] = [];
  const add = (
    x: number,
    y: number,
    o: number,
    f: number,
    from: "component" | "struct_conn",
  ) => {
    a.push(x);
    b.push(y);
    order.push(o);
    flags.push(f);
    source.push(from);
  };
  const compatible = (x: number, y: number) =>
    !atoms.altloc[x] || !atoms.altloc[y] || atoms.altloc[x] === atoms.altloc[y];

  // Atoms of each residue by name.
  const byName = residues.map(() => new Map<string, number[]>());
  for (let i = 0; i < atoms.residue.length; i++) {
    const names = byName[atoms.residue[i]];
    const list = names.get(atoms.name[i]);
    if (list) list.push(i);
    else names.set(atoms.name[i], [i]);
  }

  const componentBonds = semantics.componentBonds;
  for (let r = 0; componentBonds && r < residues.length; r++) {
    const names = byName[r];
    for (const candidates of names.values()) {
      for (const x of candidates) {
        const comp = atoms.comp[x];
        const entry = componentBonds.entries.get(comp);
        const pairs = entry?.get(atoms.name[x], atoms.element[x] === 1);
        if (!pairs) continue;
        for (const nameB of pairs.map.keys()) {
          for (const y of names.get(nameB) ?? []) {
            if (
              x >= y || atoms.comp[y] !== comp || !compatible(x, y)
            ) continue;
            const bond = pairs.get(nameB, atoms.element[y] === 1);
            if (bond) add(x, y, bond.order, bond.flags, "component");
          }
        }
      }
    }
  }

  const { model } = semantics;
  const atomSourceIndex = model.atomicHierarchy.atomSourceIndex;
  for (const connection of semantics.structConnections ?? []) {
    const x = atomSourceIndex.value(connection.partnerA.atomIndex);
    const y = atomSourceIndex.value(connection.partnerB.atomIndex);
    if (
      x < 0 || y < 0 || x >= atoms.residue.length || y >= atoms.residue.length
    ) {
      continue;
    }
    add(x, y, connection.order, connection.flags, "struct_conn");
  }
  if (!a.length) return undefined;
  return {
    count: a.length,
    a: Uint32Array.from(a),
    b: Uint32Array.from(b),
    order: Uint8Array.from(order),
    flags: Uint8Array.from(flags),
    source,
  };
}

/** Build Mol*'s normalized model once for entity, annotation and bond semantics. */
async function mmcifSemantics(frame: CifFrame, signal?: AbortSignal) {
  try {
    const [
      { trajectoryFromMmCIF },
      { ModelSecondaryStructure },
      { ComponentBond },
      { StructConn },
      { Task },
    ] = await Promise.all([
      import("molstar/lib/mol-model-formats/structure/mmcif.js"),
      import(
        "molstar/lib/mol-model-formats/structure/property/secondary-structure.js"
      ),
      import(
        "molstar/lib/mol-model-formats/structure/property/bonds/chem_comp.js"
      ),
      import(
        "molstar/lib/mol-model-formats/structure/property/bonds/struct_conn.js"
      ),
      import("molstar/lib/mol-task/index.js"),
    ]);
    signal?.throwIfAborted();
    const trajectory = await trajectoryFromMmCIF(frame).run((progress) => {
      if (signal?.aborted) progress.requestAbort("request cancelled");
    });
    signal?.throwIfAborted();
    const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
    signal?.throwIfAborted();
    return {
      model,
      secondary: ModelSecondaryStructure.Provider.get(model),
      componentBonds: ComponentBond.Provider.get(model),
      structConnections: StructConn.Provider.get(model)?.entries,
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof IoError) throw error;
    throw bcifError(
      "Unable to build the Mol* mmCIF model",
      "INVALID_BCIF",
      error,
    );
  }
}

type MmcifSemantics = Awaited<ReturnType<typeof mmcifSemantics>>;

function entityMetadata(
  semantics: MmcifSemantics,
  chains: readonly ChainRow[],
): { types: Map<string, string>; subtypes: Map<string, string> } {
  const types = new Map<string, string>();
  const subtypes = new Map<string, string>();
  for (const chain of chains) {
    const id = chain.entityId;
    if (!id || types.has(id)) continue;
    const index = semantics.model.entities.getEntityIndex(id);
    if (index < 0) continue;
    types.set(
      id,
      semantics.model.entities.data.type.value(index).toLowerCase(),
    );
    subtypes.set(id, semantics.model.entities.subtype.value(index) || "other");
  }
  return { types, subtypes };
}

/**
 * Lower Mol*'s secondary-structure property to our residue codes. Mol* sorts
 * model atoms, so source indices restore our atom_site order; labels propagate
 * the first model's annotation to matching residues across ensembles.
 */
function readSecondaryStructure(
  semantics: MmcifSemantics | undefined,
  atomResidue: Uint32Array,
  residues: readonly ResidueRow[],
  chains: readonly ChainRow[],
): Uint8Array {
  const codes = new Uint8Array(residues.length);
  const secondary = semantics?.secondary;
  if (!semantics || !secondary) return codes;

  const residuesByLabel = new Map<string, number[]>();
  for (let r = 0; r < residues.length; r++) {
    const row = residues[r], chain = chains[row.chain];
    const key = `${chain.labelId}:${row.seq}`;
    const matches = residuesByLabel.get(key) ?? [];
    matches.push(r);
    residuesByLabel.set(key, matches);
  }
  const { model } = semantics;
  const { atomSourceIndex, residueAtomSegments } = model.atomicHierarchy;
  for (let r = 0; r < residueAtomSegments.count; r++) {
    const sourceAtom = atomSourceIndex.value(residueAtomSegments.offsets[r]);
    if (sourceAtom < 0 || sourceAtom >= atomResidue.length) continue;
    const sourceResidue = residues[atomResidue[sourceAtom]];
    if (!sourceResidue) continue;
    const label = `${chains[sourceResidue.chain].labelId}:${sourceResidue.seq}`;
    const index = secondary.getIndex(r as never);
    const flags = secondary.type[index];
    // Mol* SecondaryStructureType flags are const-enum bits with no runtime
    // enum export.
    const code = flags & 2048
      ? 4 // 3-10 helix
      : flags & 32768
      ? 5 // pi helix
      : flags & 4194304
      ? 2 // isolated beta bridge
      : flags & 8388608
      ? 3 // beta strand
      : flags & 2
      ? 1 // other alpha-like helix
      : flags & 16
      ? 6 // turn
      : flags & 8
      ? 7 // bend
      : 0;
    for (const target of residuesByLabel.get(label) ?? []) {
      codes[target] = code;
    }
  }
  return codes;
}

/**
 * Lower a BinaryCIF mmCIF block to renderer-independent owned table columns.
 * `input` is the bytes, a `Blob`/`File`, or a URL fetched once.
 */
export async function structureFromBcif(
  input: FileInput,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<StructureData> {
  const parsed = await parseBcif(
    await readInput(input, "BCIF", bcifError, options),
    options.signal,
  );
  const categories = parsed.blocks[0]?.categories ?? {};
  const atom = categories.atom_site;
  if (!atom) {
    throw bcifError(
      "BCIF has no atom_site category",
      "MISSING_ATOM_SITE",
    );
  }
  const positions = new Float32Array(atom.rowCount * 3),
    ids: string[] = [],
    names: string[] = [],
    altloc: string[] = [],
    element = new Uint8Array(atom.rowCount);
  const occupancy = new Float32Array(atom.rowCount),
    bfactor = new Float32Array(atom.rowCount),
    radius = new Float32Array(atom.rowCount),
    formalCharge = new Int8Array(atom.rowCount),
    atomResidue = new Uint32Array(atom.rowCount),
    atomComp: string[] = [];
  let microheterogeneous = false;
  // Optional columns are only emitted when the file carries their source field.
  const charge = field(atom, "pdbx_formal_charge");
  // Mol* reads '?' and '.' as 0; the column only counts as imported when at
  // least one row carries a value.
  let chargeImported = false;
  const hasGroup = !!field(atom, "group_PDB"),
    hasEntity = !!field(atom, "label_entity_id");
  const residueRows = new Map<string, number>(),
    residues: ResidueRow[] = [],
    chainRows = new Map<string, number>(),
    chains: ChainRow[] = [];
  for (let i = 0; i < atom.rowCount; i++) {
    const model = Math.trunc(num(atom, "pdbx_PDB_model_num", i, 1));
    const chainId = str(atom, "label_asym_id", i, "");
    const chainKey = `${model}:${chainId}`;
    let chain = chainRows.get(chainKey);
    if (chain === undefined) {
      chain = chains.length;
      chainRows.set(chainKey, chain);
      chains.push({
        model,
        entityId: str(atom, "label_entity_id", i, ""),
        labelId: chainId,
        authId: str(atom, "auth_asym_id", i, chainId),
      });
    }
    const seq = Math.trunc(num(atom, "label_seq_id", i, -1)),
      comp = str(atom, "label_comp_id", i, "UNK");
    // label_seq_id is intentionally absent for non-polymer entities. Include
    // author numbering so consecutive waters and ligands remain distinct rows.
    const authSeq = str(atom, "auth_seq_id", i, String(seq));
    // Like Mol*, the component is not part of residue identity, so a
    // microheterogeneous position (PRO/SER at one seq id) stays one residue;
    // atoms keep their own component in atoms.comp.
    const residueKey = `${chain}:${seq}:${authSeq}:${
      str(atom, "pdbx_PDB_ins_code", i)
    }`;
    let residue = residueRows.get(residueKey);
    if (residue === undefined) {
      residue = residues.length;
      residueRows.set(residueKey, residue);
      residues.push({
        chain,
        seq,
        authSeq,
        insertion: str(atom, "pdbx_PDB_ins_code", i),
        comp,
        // Mol* reads is-het from the residue's first atom record.
        het: str(atom, "group_PDB", i) === "ATOM" ? 0 : 1,
      });
    }
    atomResidue[i] = residue;
    atomComp.push(comp);
    if (comp !== residues[residue].comp) microheterogeneous = true;
    ids.push(str(atom, "id", i, String(i + 1)));
    names.push(str(atom, "label_atom_id", i, ""));
    altloc.push(str(atom, "label_alt_id", i));
    const atomic = atomicNumberForSymbol(str(atom, "type_symbol", i));
    element[i] = atomic;
    radius[i] = elementRadius(atomic);
    positions[i * 3] = num(atom, "Cartn_x", i);
    positions[i * 3 + 1] = num(atom, "Cartn_y", i);
    positions[i * 3 + 2] = num(atom, "Cartn_z", i);
    occupancy[i] = num(atom, "occupancy", i, 1);
    bfactor[i] = num(atom, "B_iso_or_equiv", i, 0);
    if (charge && charge.valueKind(i) === 0) {
      formalCharge[i] = Math.trunc(charge.float(i));
      chargeImported = true;
    }
  }
  const residueCount = residues.length, chainCount = chains.length;
  const ssAnnotated = !!(categories.struct_conf ||
    categories.struct_sheet_range);
  const hasConnections =
    !!(categories.chem_comp_bond || categories.struct_conn);
  const semantics = hasEntity || ssAnnotated || hasConnections
    ? await mmcifSemantics(parsed.blocks[0]!, options.signal)
    : undefined;
  const { types: entityTypes, subtypes: entitySubtypes } =
    semantics && hasEntity ? entityMetadata(semantics, chains) : {
      types: new Map<string, string>(),
      subtypes: new Map<string, string>(),
    };
  const secondaryStructure = readSecondaryStructure(
    semantics,
    atomResidue,
    residues,
    chains,
  );
  const links = readLinks(
    semantics,
    { name: names, altloc, comp: atomComp, element, residue: atomResidue },
    residues,
  );
  // Mol* always has model secondary structure for mmCIF: the annotation, or
  // all none when the file has neither category.
  const data = createStructure({
    positions,
    topology: {
      atoms: {
        count: atom.rowCount,
        id: ids,
        name: names,
        altloc,
        residue: atomResidue,
        element,
        occupancy,
        bfactor,
        radius,
        ...(microheterogeneous ? { comp: atomComp } : {}),
      },
      residues: {
        count: residueCount,
        chain: Uint32Array.from(residues, (r) => r.chain),
        labelSeq: Int32Array.from(residues, (r) => r.seq),
        authSeq: residues.map((r) => r.authSeq),
        insertionCode: residues.map((r) => r.insertion),
        comp: residues.map((r) => r.comp),
        polymer: residues.map((r) => polymerKind(r.comp)),
        ...(hasGroup ? { het: Uint8Array.from(residues, (r) => r.het) } : {}),
      },
      chains: {
        count: chainCount,
        model: Int32Array.from(chains, (c) => c.model),
        labelId: chains.map((c) => c.labelId),
        authId: chains.map((c) => c.authId),
        ...(hasEntity
          ? {
            entityId: chains.map((c) => c.entityId),
            entityType: chains.map((c) => entityTypes.get(c.entityId) ?? ""),
            entitySubtype: chains.map((c) =>
              entitySubtypes.get(c.entityId) ?? "other"
            ),
          }
          : {}),
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      ...(links ? { links } : {}),
      instances: {
        count: chainCount,
        chain: Uint32Array.from({ length: chainCount }, (_, i) => i),
        operatorId: new Array(chainCount).fill("identity"),
        transform: Float64Array.from(
          { length: chainCount * 16 },
          (_, i) =>
            i % 16 === 0 || i % 16 === 5 || i % 16 === 10 || i % 16 === 15
              ? 1
              : 0,
        ),
      },
    },
  });
  // Every io structure resolves formalCharge, as in Mol*: imported values, or
  // zeros marked 'default' when the file has none.
  return withAttributes(data, {
    formalCharge: {
      domain: "atom",
      kind: "code",
      values: formalCharge,
      provenance: chargeImported ? "imported:mmcif" : "default",
    },
    ssCode: {
      domain: "residue",
      kind: "code",
      values: secondaryStructure,
      provenance: ssAnnotated ? "imported:mmcif" : "default",
    },
  });
}
