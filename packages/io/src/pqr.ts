// PQR (PDB with charge and radius) reader and charge transfer onto an existing
// structure. Records are tokenised by whitespace rather than by PDB columns:
// PDB2PQR's fields drift out of the fixed columns once coordinates or serials
// widen, and Mol*'s PQR variant reads only the charge.
import {
  createStructure,
  elementRadius,
  type StructureData,
  withAttributes,
} from "@molgpu/table";
import { AMINO_ACID_NAMES, ELEMENT, polymerKind } from "./residues.ts";
import type {
  PqrApplyReport,
  PqrErrorCode,
  PqrStructureReport,
} from "./types.ts";

/** A machine-readable failure reading or applying a PQR file. */
export class PqrParseError extends Error {
  override readonly name: "PqrParseError";
  readonly code: PqrErrorCode;
  constructor(message: string, code: PqrErrorCode, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PqrParseError";
    this.code = code;
  }
}

/** Parsed ATOM/HETATM records, one row per record, in file order. */
interface Records {
  count: number;
  het: boolean[];
  name: string[];
  altloc: string[];
  comp: string[];
  chain: string[];
  seq: number[];
  insertion: string[];
  model: number[];
  /** Chain segment: advances at each TER record and each MODEL. */
  segment: number[];
  xyz: number[];
  charge: number[];
  radius: number[];
}

const NUMBER = /[-+]?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const SEQ = /^(-?\d+)([A-Za-z]?)$/;

function fail(message: string, code: PqrErrorCode = "INVALID_PQR"): never {
  throw new PqrParseError(message, code);
}

/** Tokenise one ATOM/HETATM line into `out`; throws with the line number. */
function readRecord(
  line: string,
  lineNo: number,
  out: Records,
  model: number,
  segment: number,
): void {
  const tokens = line.trim().split(/\s+/);
  // Trailing tokens with a decimal point hold x y z charge radius; a wide
  // column-aligned file may glue neighbours ("-100.123-200.456").
  let tail = tokens.length;
  while (tail > 0 && tokens[tail - 1].includes(".")) tail--;
  const numbers = tokens.slice(tail).join(" ").match(NUMBER) ?? [];
  if (numbers.length !== 5) {
    fail(`line ${lineNo}: expected x y z charge radius, got "${line}"`);
  }
  // Split "ATOM12345" / "HETATM12345" when the serial fills its field.
  const head = tokens.slice(0, tail);
  const record = head[0].startsWith("HETATM") ? "HETATM" : "ATOM";
  head.splice(
    0,
    1,
    ...(head[0].length > record.length ? [head[0].slice(record.length)] : []),
  );
  // head: serial name [altloc]resName [chain] resSeq[iCode]
  if (head.length !== 4 && head.length !== 5) {
    fail(`line ${lineNo}: expected serial, name, residue and sequence`);
  }
  const seq = SEQ.exec(head[head.length - 1]);
  if (!seq) fail(`line ${lineNo}: bad residue sequence "${head.at(-1)}"`);
  // PDB2PQR drops alternate locations, so a 4-character residue field is a
  // force-field name (NALA, CALA), never an altloc plus a residue.
  const comp = head[2];
  const [x, y, z, charge, radius] = numbers.map(Number);
  if (![x, y, z, charge, radius].every(Number.isFinite) || radius < 0) {
    fail(`line ${lineNo}: non-finite value or negative radius`);
  }
  out.het.push(record === "HETATM");
  out.name.push(head[1]);
  out.altloc.push("");
  out.comp.push(comp);
  out.chain.push(head.length === 5 ? head[3] : "");
  out.seq.push(Number(seq[1]));
  out.insertion.push(seq[2]);
  out.model.push(model);
  out.segment.push(segment);
  out.xyz.push(x, y, z);
  out.charge.push(charge);
  out.radius.push(radius);
  out.count++;
}

/** Parse PQR text (or UTF-8 bytes) line by line, without splitting the file. */
function parseRecords(input: string | Uint8Array): Records {
  const text = typeof input === "string"
    ? input
    : input instanceof Uint8Array
    ? new TextDecoder().decode(input)
    : fail("expected a string or Uint8Array", "INVALID_INPUT");
  const out: Records = {
    count: 0,
    het: [],
    name: [],
    altloc: [],
    comp: [],
    chain: [],
    seq: [],
    insertion: [],
    model: [],
    segment: [],
    xyz: [],
    charge: [],
    radius: [],
  };
  let model = 1, segment = 0, lineNo = 0;
  for (let start = 0; start < text.length;) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, "");
    start = end + 1;
    lineNo++;
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      readRecord(line, lineNo, out, model, segment);
    } else if (line.startsWith("MODEL")) {
      model = Number(line.slice(5).trim()) || model + 1;
      segment++;
    } else if (line.startsWith("TER")) segment++;
  }
  if (!out.count) fail("no ATOM or HETATM records", "NO_ATOMS");
  return out;
}

// Force-field names PDB2PQR writes that Mol*'s component sets lack: cystine
// and deprotonated cysteine, N/C-terminal variants (NALA, CALA) and AMBER
// nucleotides (DA5, RA3). BCIF classification keeps Mol*'s sets unchanged.
const pqrPolymerKind = (comp: string): ReturnType<typeof polymerKind> => {
  const kind = polymerKind(comp);
  if (kind !== "other") return kind;
  const name = comp.toUpperCase();
  if (name === "CYX" || name === "CYM") return "protein";
  if (/^[NC]/.test(name) && AMINO_ACID_NAMES.has(name.slice(1))) {
    return "protein";
  }
  if (/^D[ACGTU][35N]?$/.test(name)) return "dna";
  if (/^R?[ACGU][35N]?$/.test(name)) return "rna";
  return "other";
};

let guessElement:
  | ((atomId: string, compId: string) => string)
  | undefined;
async function elementGuesser(): Promise<
  (atomId: string, compId: string) => string
> {
  if (guessElement) return guessElement;
  try {
    const util = await import(
      "molstar/lib/mol-model-formats/structure/util.js"
    );
    return guessElement = util.guessElementSymbolString;
  } catch (error) {
    throw new PqrParseError(
      "Unable to load the optional Mol* element guesser",
      "PARSER_UNAVAILABLE",
      error,
    );
  }
}

/**
 * Read a PQR file into a structure. Records become atoms (grouped into
 * residues by chain, sequence and insertion code, and into chains by chain ID,
 * TER records and models). `partialCharge` and `pqr:radius` are set with
 * provenance `imported:pqr`. `atoms.radius` is the PQR radius where positive
 * and the element radius where the file gives 0 (AMBER hydroxyl and water
 * hydrogens); `report.radiusFallbacks` counts those atoms.
 */
export async function structureFromPqr(
  input: string | Uint8Array,
): Promise<{ data: StructureData; report: PqrStructureReport }> {
  const rec = parseRecords(input);
  const guess = await elementGuesser();
  const n = rec.count;
  const element = new Uint8Array(n), radius = new Float32Array(n);
  const atomResidue = new Uint32Array(n);
  let radiusFallbacks = 0;
  const residueRows = new Map<string, number>(),
    chainRows = new Map<
      string,
      number
    >();
  const residues: {
    chain: number;
    seq: number;
    insertion: string;
    comp: string;
    het: number;
  }[] = [];
  const chains: { model: number; labelId: string; authId: string }[] = [];
  // Mol*'s label rule: an auth chain ID reused after TER in one model gets a
  // "_n" suffix.
  const labelUses = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const chainKey = `${rec.model[i]}:${rec.segment[i]}:${rec.chain[i]}`;
    let chain = chainRows.get(chainKey);
    if (chain === undefined) {
      chain = chains.length;
      chainRows.set(chainKey, chain);
      const useKey = `${rec.model[i]}:${rec.chain[i]}`;
      const uses = labelUses.get(useKey) ?? 0;
      labelUses.set(useKey, uses + 1);
      chains.push({
        model: rec.model[i],
        authId: rec.chain[i],
        labelId: uses ? `${rec.chain[i]}_${uses}` : rec.chain[i],
      });
    }
    const residueKey = `${chain}:${rec.seq[i]}:${rec.insertion[i]}`;
    let residue = residueRows.get(residueKey);
    if (residue === undefined) {
      residue = residues.length;
      residueRows.set(residueKey, residue);
      residues.push({
        chain,
        seq: rec.seq[i],
        insertion: rec.insertion[i],
        comp: rec.comp[i],
        het: rec.het[i] ? 1 : 0,
      });
    }
    atomResidue[i] = residue;
    element[i] = ELEMENT[guess(rec.name[i], rec.comp[i]).toUpperCase()] ?? 0;
    if (rec.radius[i] > 0) radius[i] = rec.radius[i];
    else {
      radius[i] = elementRadius(element[i]);
      radiusFallbacks++;
    }
  }
  const chainCount = chains.length;
  let data: StructureData;
  try {
    data = createStructure({
      positions: Float32Array.from(rec.xyz),
      topology: {
        atoms: {
          count: n,
          id: Array.from({ length: n }, (_, i) => String(i + 1)),
          name: rec.name,
          altloc: rec.altloc,
          residue: atomResidue,
          element,
          occupancy: new Float32Array(n).fill(1),
          bfactor: new Float32Array(n),
          radius,
        },
        residues: {
          count: residues.length,
          chain: Uint32Array.from(residues, (r) => r.chain),
          labelSeq: Int32Array.from(residues, (r) => r.seq),
          authSeq: residues.map((r) => String(r.seq)),
          insertionCode: residues.map((r) => r.insertion),
          comp: residues.map((r) => r.comp),
          polymer: residues.map((r) => pqrPolymerKind(r.comp)),
          het: Uint8Array.from(residues, (r) => r.het),
        },
        chains: {
          count: chainCount,
          model: Int32Array.from(chains, (c) => c.model),
          labelId: chains.map((c) => c.labelId),
          authId: chains.map((c) => c.authId),
        },
        bonds: {
          count: 0,
          a: new Uint32Array(),
          b: new Uint32Array(),
          order: new Uint8Array(),
          source: [],
        },
        instances: {
          count: chainCount,
          chain: Uint32Array.from({ length: chainCount }, (_, i) => i),
          operatorId: new Array(chainCount).fill("identity"),
          transform: Float64Array.from(
            { length: chainCount * 16 },
            (_, i) => i % 16 % 5 === 0 ? 1 : 0,
          ),
        },
      },
    });
  } catch (error) {
    // Duplicate atom names in one residue, for example.
    throw new PqrParseError(
      `PQR records do not form a valid structure: ${(error as Error).message}`,
      "INVALID_PQR",
      error,
    );
  }
  return {
    data: withAttributes(data, {
      partialCharge: {
        domain: "atom",
        kind: "scalar",
        values: Float32Array.from(rec.charge),
        provenance: "imported:pqr",
      },
      "pqr:radius": {
        domain: "atom",
        kind: "scalar",
        values: Float32Array.from(rec.radius),
        provenance: "imported:pqr",
      },
    }),
    report: Object.freeze({ atoms: n, radiusFallbacks }),
  };
}

const FOLD_DISTANCE = 1.3;
const DELTA_TOLERANCE = 1e-3;

/**
 * Set `partialCharge` on an existing structure from PQR records, matched by
 * (auth chain, auth seq, insertion code, atom name). PDB2PQR may rename
 * residues (HIS→HIE, CYS→CYX), so the component is not part of the match. A
 * record applies in every model and to every altloc copy of its atom. In each
 * model and altloc copy that lacks a PQR hydrogen, its charge folds onto the
 * nearest heavy atom of that copy within 1.3 Å (in the PQR's coordinates), which
 * keeps residue net charge on heavy-atom structures. Chain-less records throw
 * `AMBIGUOUS_CHAIN` only when their own residue spans several chains.
 * Unmatched structure atoms get 0.
 */
export function applyPqr(
  data: StructureData,
  input: string | Uint8Array,
): { data: StructureData; report: PqrApplyReport } {
  const rec = parseRecords(input);
  const { atoms, residues, chains } = data.topology;
  const chainless = rec.chain.every((c) => c === "");
  // Residue rows per (chain, seq, insertion); atom rows per name within each.
  const residueIndex = new Map<string, number[]>();
  for (let r = 0; r < residues.count; r++) {
    const key = `${chainless ? "" : chains.authId[residues.chain[r]]}:${
      residues.authSeq[r]
    }:${residues.insertionCode[r]}`;
    let rows = residueIndex.get(key);
    if (!rows) residueIndex.set(key, rows = []);
    rows.push(r);
  }
  const residueAtoms = new Map<number, Map<string, number[]>>();
  for (let i = 0; i < atoms.count; i++) {
    const r = atoms.residue[i];
    let byName = residueAtoms.get(r);
    if (!byName) residueAtoms.set(r, byName = new Map());
    const rows = byName.get(atoms.name[i]);
    if (rows) rows.push(i);
    else byName.set(atoms.name[i], [i]);
  }
  // Each residue row's conformers: its altloc codes, or "" when it has none.
  // An atom with no altloc belongs to every conformer of its row.
  const conformers = (r: number): string[] => {
    const codes = new Set<string>();
    for (const rows of residueAtoms.get(r)?.values() ?? []) {
      for (const i of rows) if (atoms.altloc[i]) codes.add(atoms.altloc[i]);
    }
    return codes.size ? [...codes] : [""];
  };
  const inCopy = (r: number, name: string, alt: string): number[] =>
    (residueAtoms.get(r)?.get(name) ?? []).filter((i) =>
      !atoms.altloc[i] || atoms.altloc[i] === alt
    );
  const values = new Float32Array(atoms.count);
  const assigned = new Uint8Array(atoms.count);
  const unmatchedRecords: string[] = [];
  // Per PQR residue: its record sum, and the structure residues it reached.
  const pqrResidues = new Map<
    string,
    { sum: number; rows: number[]; hydrogens: number[]; heavy: number[] }
  >();
  const models = rec.model[0];
  for (let k = 0; k < rec.count; k++) {
    // A multi-model PQR repeats its charges; the first model is the source.
    if (rec.model[k] !== models) continue;
    const key = `${rec.chain[k]}:${rec.seq[k]}:${rec.insertion[k]}`;
    let group = pqrResidues.get(key);
    if (!group) {
      const rows = residueIndex.get(key) ?? [];
      if (chainless) {
        // Without chain IDs a key may only span copies of one chain (models).
        const labels = new Set(
          rows.map((r) => chains.labelId[residues.chain[r]]),
        );
        if (labels.size > 1) {
          throw new PqrParseError(
            `PQR has no chain IDs and residue ${key.slice(1)} is in chains ${
              [...labels].join(", ")
            }`,
            "AMBIGUOUS_CHAIN",
          );
        }
      }
      group = {
        sum: 0,
        rows,
        hydrogens: [],
        heavy: [],
      };
      pqrResidues.set(key, group);
    }
    group.sum += rec.charge[k];
    let hit = false;
    for (const r of group.rows) {
      for (const i of residueAtoms.get(r)?.get(rec.name[k]) ?? []) {
        values[i] = rec.charge[k];
        assigned[i] = 1;
        hit = true;
      }
    }
    // A hydrogen may be present in some model or altloc copies and missing
    // from others, so folding decides per copy below.
    const isHydrogen = /^\d*H/i.test(rec.name[k]);
    if (isHydrogen && group.rows.length) group.hydrogens.push(k);
    else if (hit) group.heavy.push(k);
    else unmatchedRecords.push(`${key}:${rec.name[k]}`);
  }
  // Fold each hydrogen onto its nearest heavy atom in every copy lacking it.
  const d2 = (a: number, b: number): number => {
    const dx = rec.xyz[a * 3] - rec.xyz[b * 3],
      dy = rec.xyz[a * 3 + 1] - rec.xyz[b * 3 + 1],
      dz = rec.xyz[a * 3 + 2] - rec.xyz[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  for (const [key, group] of pqrResidues) {
    for (const h of group.hydrogens) {
      const targets = new Set<number>();
      let lost = false;
      for (const r of group.rows) {
        for (const alt of conformers(r)) {
          if (inCopy(r, rec.name[h], alt).length) continue;
          let best = -1, bestD = FOLD_DISTANCE * FOLD_DISTANCE;
          for (const k of group.heavy) {
            if (!inCopy(r, rec.name[k], alt).length) continue;
            const d = d2(h, k);
            if (d <= bestD) [best, bestD] = [k, d];
          }
          if (best < 0) lost = true;
          else for (const i of inCopy(r, rec.name[best], alt)) targets.add(i);
        }
      }
      if (lost) unmatchedRecords.push(`${key}:${rec.name[h]}`);
      // A shared (no-altloc) heavy atom takes the charge once.
      for (const i of targets) values[i] += rec.charge[h];
    }
  }
  const unmatchedAtoms: string[] = [];
  let matched = 0;
  for (let i = 0; i < atoms.count; i++) {
    if (assigned[i]) {
      matched++;
      continue;
    }
    const r = atoms.residue[i];
    unmatchedAtoms.push(
      `${chains.authId[residues.chain[r]]}:${residues.authSeq[r]}:${
        residues.insertionCode[r]
      }:${atoms.name[i]}`,
    );
  }
  const residueDelta: PqrApplyReport["residueDelta"][number][] = [];
  for (const [key, group] of pqrResidues) {
    for (const r of group.rows) {
      for (const alt of conformers(r)) {
        // One atom per name in this model and conformer.
        let assignedSum = 0;
        for (const name of residueAtoms.get(r)?.keys() ?? []) {
          const copy = inCopy(r, name, alt);
          if (copy.length) assignedSum += values[copy[0]];
        }
        if (Math.abs(assignedSum - group.sum) > DELTA_TOLERANCE) {
          residueDelta.push(
            Object.freeze({
              residue: key,
              model: chains.model[residues.chain[r]],
              altloc: alt,
              pqr: group.sum,
              assigned: assignedSum,
            }),
          );
        }
      }
    }
  }
  return {
    data: withAttributes(data, {
      partialCharge: {
        domain: "atom",
        kind: "scalar",
        values,
        provenance: "imported:pqr",
      },
    }),
    report: Object.freeze({
      matched,
      unmatchedAtoms: Object.freeze(unmatchedAtoms),
      unmatchedRecords: Object.freeze(unmatchedRecords),
      residueDelta: Object.freeze(residueDelta),
    }),
  };
}
