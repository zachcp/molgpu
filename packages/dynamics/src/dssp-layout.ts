import type { StructureData } from "@molgpu/table";

/** One residue occupies three vec4<i32> records in the GPU descriptor table. */
export interface DsspLayout {
  readonly descriptors: Int32Array;
  readonly caMap: Uint32Array;
  readonly residues: Uint32Array;
  readonly unitStarts: Uint32Array;
  readonly residueCount: number;
  readonly atomCount: number;
  readonly totalResidues: number;
}

/**
 * Flatten the CPU DSSP units into sequence order for a single model. Each
 * chain is one unit; the first active row of each backbone atom wins.
 */
export function prepareDsspLayout(
  data: StructureData,
  rows: ArrayLike<number>,
): DsspLayout {
  const { atoms, residues, chains } = data.topology;
  let model: number | undefined;
  const first = new Map<number, Map<string, number>>();
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    if (!Number.isInteger(row) || row < 0 || row >= atoms.count) {
      throw new RangeError(`DSSP atom row ${row} is out of range`);
    }
    const residue = atoms.residue[row];
    const rowModel = chains.model[residues.chain[residue]];
    if (model === undefined) model = rowModel;
    if (rowModel !== model) {
      throw new TypeError("GPU DSSP rows must belong to one model");
    }
    if (residues.polymer[residue] !== "protein") continue;
    let names = first.get(residue);
    if (!names) first.set(residue, names = new Map());
    const name = atoms.name[row];
    if (!names.has(name)) names.set(name, row);
  }
  const byChain = new Map<number, number[]>();
  for (const residue of [...first.keys()].sort((a, b) => a - b)) {
    const chain = residues.chain[residue];
    let unit = byChain.get(chain);
    if (!unit) byChain.set(chain, unit = []);
    unit.push(residue);
  }
  const ordered: number[] = [];
  const starts = [0];
  for (const unit of byChain.values()) {
    unit.sort((a, b) => residues.labelSeq[a] - residues.labelSeq[b] || a - b);
    ordered.push(...unit);
    starts.push(ordered.length);
  }
  const descriptors = new Int32Array(ordered.length * 12);
  const caMap: number[] = [];
  let unit = 0;
  for (let i = 0; i < ordered.length; i++) {
    while (i >= starts[unit + 1]) unit++;
    const names = first.get(ordered[i])!;
    const previous = i > starts[unit] ? first.get(ordered[i - 1])! : null;
    const at = (source: Map<string, number> | null, name: string) =>
      source?.get(name) ?? -1;
    const offset = i * 12;
    descriptors.set([
      at(names, "N"),
      at(names, "CA"),
      at(names, "C"),
      at(names, "O"),
      at(names, "H"),
      at(previous, "C"),
      at(previous, "O"),
      names.has("OXT") ? 1 : 0,
      starts[unit],
      starts[unit + 1],
      ordered[i],
      unit,
    ], offset);
    if (names.has("CA")) caMap.push(i);
  }
  return Object.freeze({
    descriptors,
    caMap: Uint32Array.from(caMap),
    residues: Uint32Array.from(ordered),
    unitStarts: Uint32Array.from(starts),
    residueCount: ordered.length,
    atomCount: atoms.count,
    totalResidues: residues.count,
  });
}

export interface DsspBridge {
  readonly partner1: number;
  readonly partner2: number;
  readonly type: number;
  /** Generating H-bond edge and bridge test, restoring CPU generation order. */
  readonly acceptor: number;
  readonly donor: number;
  readonly pattern: number;
}

interface Ladder {
  previousLadder: number;
  nextLadder: number;
  firstStart: number;
  firstEnd: number;
  secondStart: number;
  secondEnd: number;
  type: number;
}

/** Finish Mol*'s sequential ladder and sheet assignment on the compact GPU output. */
export function finishDssp(
  layout: DsspLayout,
  gpuFlags: Uint32Array,
  bridges: readonly DsspBridge[],
): Uint8Array {
  const m = layout.residueCount;
  if (gpuFlags.length < m) throw new RangeError("GPU DSSP flags are truncated");
  const flags = gpuFlags.slice(0, m);
  const ordered = [...bridges].sort((a, b) =>
    a.partner1 - b.partner1 || a.acceptor - b.acceptor ||
    a.donor - b.donor || a.pattern - b.pattern
  );
  const starts = layout.unitStarts;
  let bridgeIndex = 0;
  for (let unit = 0; unit + 1 < starts.length; unit++) {
    const start = starts[unit], end = starts[unit + 1];
    const local: DsspBridge[] = [];
    while (
      bridgeIndex < ordered.length && ordered[bridgeIndex].partner1 < end
    ) {
      const bridge = ordered[bridgeIndex++];
      if (bridge.partner1 < start) {
        throw new RangeError("GPU DSSP bridge falls outside a unit");
      }
      local.push(bridge);
    }
    const ladders: Ladder[] = [];
    for (const b of local) {
      if (b.partner2 < start || b.partner2 >= end) {
        throw new RangeError("GPU DSSP bridge crosses a unit");
      }
      flags[b.partner1] |= 2;
      flags[b.partner2] |= 2;
      let found = false;
      for (const ladder of ladders) {
        if (
          b.type !== ladder.type || b.partner1 !== ladder.firstEnd + 1 ||
          b.partner2 !==
            (b.type === 0 ? ladder.secondEnd + 1 : ladder.secondStart - 1)
        ) continue;
        found = true;
        ladder.firstEnd++;
        if (b.type === 0) ladder.secondEnd++;
        else ladder.secondStart--;
      }
      if (!found) {
        ladders.push({
          previousLadder: 0,
          nextLadder: 0,
          firstStart: b.partner1,
          firstEnd: b.partner1,
          secondStart: b.partner2,
          secondEnd: b.partner2,
          type: b.type,
        });
      }
    }
    const bulge = (a: Ladder, b: Ladder) =>
      b.secondStart - a.secondEnd > 0 &&
      ((b.secondStart - a.secondEnd < 6 && b.firstStart - a.firstEnd < 3) ||
        b.secondStart - a.secondEnd < 3);
    for (let i1 = 0; i1 < ladders.length; i1++) {
      for (let i2 = i1; i2 < ladders.length; i2++) {
        const a = ladders[i1], b = ladders[i2];
        if (
          a.type !== b.type || b.firstStart - a.firstEnd >= 6 ||
          a.firstStart >= b.firstStart || b.nextLadder !== 0 ||
          !(a.type === 0 ? bulge(a, b) : bulge(b, a))
        ) continue;
        a.nextLadder = i2;
        b.previousLadder = i1;
      }
    }
    for (const ladder of ladders) {
      for (let i = ladder.firstStart; i <= ladder.firstEnd; i++) {
        const j = ladder.secondStart + (i - ladder.firstStart);
        if (ladder.firstStart !== ladder.firstEnd) {
          flags[i] |= 4;
          flags[j] |= 4;
        } else {
          if (!(flags[i] & (1 | 8 | 16)) && (flags[i] & 4)) flags[i] |= 2;
          if (!(flags[j] & (1 | 8 | 16)) && (flags[j] & 4)) flags[j] |= 2;
        }
      }
      if (ladder.nextLadder === 0) continue;
      const connected = ladders[ladder.nextLadder];
      for (let i = ladder.firstStart; i <= connected.firstEnd; i++) {
        flags[i] |= 4;
      }
      if (ladder.type === 0) {
        for (let i = ladder.secondStart; i <= connected.secondEnd; i++) {
          flags[i] |= 4;
        }
      } else {
        for (let i = connected.secondEnd; i <= ladder.secondStart; i++) {
          flags[i] |= 4;
        }
      }
    }
  }
  const codes = new Uint8Array(layout.totalResidues);
  for (let i = 0; i < m; i++) {
    const f = flags[i];
    codes[layout.residues[i]] = f & 1
      ? 1
      : f & 4
      ? 3
      : f & 2
      ? 2
      : f & 8
      ? 4
      : f & 16
      ? 5
      : f & 64
      ? 6
      : f & 32
      ? 7
      : 0;
  }
  return codes;
}
