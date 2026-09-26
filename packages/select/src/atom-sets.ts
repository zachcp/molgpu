// Internal evaluation values for SelectionExpr: a selection is either every atom
// on its own ("singletons") or a sequence of atom sets. This mirrors Mol*'s
// StructureSelection (mol-model/structure/query/selection.js), because MolQL
// filters and modifiers act per set. It never leaves this package: resolve()
// flattens it into an ordinary Selection (decision molgpu-sept-922.1).
//
// Every Uint32Array here is sorted, unique atom rows.

export type AtomSets =
  | { readonly kind: "singletons"; readonly atoms: Uint32Array }
  | { readonly kind: "sequence"; readonly sets: readonly Uint32Array[] };

const EMPTY_ROWS = new Uint32Array(0);
export const EMPTY: AtomSets = Object.freeze({
  kind: "singletons",
  atoms: EMPTY_ROWS,
});

export const singletons = (atoms: Uint32Array): AtomSets => ({
  kind: "singletons",
  atoms,
});

/** Mol*'s structureCount: atoms for singletons, sets for a sequence. */
export const setCount = (sel: AtomSets): number =>
  sel.kind === "singletons" ? sel.atoms.length : sel.sets.length;

/** Visit every set; a singleton selection yields one-atom sets. */
export function forEachSet(
  sel: AtomSets,
  visit: (set: Uint32Array, index: number) => void,
): void {
  if (sel.kind === "sequence") {
    sel.sets.forEach(visit);
    return;
  }
  for (let k = 0; k < sel.atoms.length; k++) {
    visit(sel.atoms.subarray(k, k + 1), k);
  }
}

/** Sorted unique rows from any iterable, using a mark array over `count` rows. */
export function sortedRows(rows: Iterable<number>, count: number): Uint32Array {
  const seen = new Uint8Array(count);
  let n = 0;
  for (const i of rows) {
    if (!seen[i]) {
      seen[i] = 1;
      n++;
    }
  }
  const out = new Uint32Array(n);
  for (let i = 0, k = 0; k < n; i++) if (seen[i]) out[k++] = i;
  return out;
}

/** Union of every set (Mol*'s unionStructure). */
export function flatten(sel: AtomSets, count: number): Uint32Array {
  if (sel.kind === "singletons") return sel.atoms;
  if (sel.sets.length === 1) return sel.sets[0];
  const seen = new Uint8Array(count);
  let n = 0;
  for (const set of sel.sets) {
    for (const i of set) {
      if (!seen[i]) {
        seen[i] = 1;
        n++;
      }
    }
  }
  const out = new Uint32Array(n);
  for (let i = 0, k = 0; k < n; i++) if (seen[i]) out[k++] = i;
  return out;
}

export function intersectRows(a: Uint32Array, b: Uint32Array): Uint32Array {
  const out: number[] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return Uint32Array.from(out);
}

export function subtractRows(a: Uint32Array, b: Uint32Array): Uint32Array {
  const out: number[] = [];
  for (let i = 0, j = 0; i < a.length; i++) {
    while (j < b.length && b[j] < a[i]) j++;
    if (j >= b.length || b[j] !== a[i]) out.push(a[i]);
  }
  return Uint32Array.from(out);
}

const sameRows = (a: Uint32Array, b: Uint32Array): boolean => {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
};

const hashRows = (rows: Uint32Array): number => {
  let h = 0x811c9dc5;
  for (let k = 0; k < rows.length; k++) {
    h ^= rows[k];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/**
 * Collects sets into a selection the way Mol*'s builders do: empty sets are
 * dropped, `unique` drops repeated sets (UniqueBuilder) and otherwise keeps
 * them (LinearBuilder), and when every set has one atom the result collapses
 * to singletons.
 */
export class SetBuilder {
  private readonly sets: Uint32Array[] = [];
  private readonly seen = new Map<number, Uint32Array[]>();
  private allSingletons = true;

  constructor(private readonly count: number, private readonly unique = true) {}

  add(set: Uint32Array): void {
    if (set.length === 0) return;
    if (this.unique) {
      const h = hashRows(set);
      const bucket = this.seen.get(h);
      if (bucket?.some((other) => sameRows(other, set))) return;
      if (bucket) bucket.push(set);
      else this.seen.set(h, [set]);
    }
    if (set.length !== 1) this.allSingletons = false;
    this.sets.push(set);
  }

  selection(): AtomSets {
    if (this.sets.length === 0) return EMPTY;
    if (this.allSingletons) {
      return singletons(sortedRows(this.sets.map((s) => s[0]), this.count));
    }
    return { kind: "sequence", sets: this.sets };
  }
}
