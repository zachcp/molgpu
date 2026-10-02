// Pure planning for biological assembly copies: which
// operator copies a structure draws and which atom rows each copy owns.
import type { StructureData } from "@molgpu/table";

/** One drawn copy: its operator and the sorted atom rows its chains own. */
export interface InstanceCopy {
  readonly index: number;
  readonly operatorId: string;
  readonly matrix: Float32Array;
  readonly rows: Uint32Array;
}

export const isIdentity = (m: ArrayLike<number>) =>
  m.length === 16 &&
  Array.prototype.every.call(
    m,
    (v: number, i: number) => v === (i % 5 === 0 ? 1 : 0),
  );

const copiesCache = new WeakMap<object, readonly InstanceCopy[]>();

/**
 * The copies `data` draws: none (draw rows as they are) for an empty instance
 * table or one identity row per chain; otherwise one per distinct operator,
 * each owning the rows of the chains it lists.
 */
export function instanceCopies(data: StructureData): readonly InstanceCopy[] {
  const key = data.topology;
  const cached = copiesCache.get(key);
  if (cached) return cached;
  const { instances, chains, residues, atoms } = data.topology;
  let copies: InstanceCopy[] = [];
  const seen = new Set<number>();
  let asymmetricUnit = instances.count === chains.count;
  for (let i = 0; i < instances.count && asymmetricUnit; i++) {
    const m = instances.transform.subarray(i * 16, i * 16 + 16);
    if (!isIdentity(m) || seen.has(instances.chain[i])) asymmetricUnit = false;
    seen.add(instances.chain[i]);
  }
  if (instances.count && !asymmetricUnit) {
    const groups = new Map<
      string,
      { matrix: Float32Array; chains: Set<number> }
    >();
    for (let i = 0; i < instances.count; i++) {
      const m = instances.transform.subarray(i * 16, i * 16 + 16);
      const id = `${instances.operatorId[i]}\0${Array.from(m).join()}`;
      let group = groups.get(id);
      if (!group) {
        groups.set(
          id,
          group = { matrix: Float32Array.from(m), chains: new Set() },
        );
      }
      group.chains.add(instances.chain[i]);
    }
    copies = [...groups.entries()].map(([id, group], index) => {
      const rows: number[] = [];
      for (let a = 0; a < atoms.count; a++) {
        if (group.chains.has(residues.chain[atoms.residue[a]])) rows.push(a);
      }
      return Object.freeze({
        index,
        operatorId: id.slice(0, id.indexOf("\0")),
        matrix: group.matrix,
        rows: Uint32Array.from(rows),
      });
    });
  }
  const frozen = Object.freeze(copies);
  copiesCache.set(key, frozen);
  return frozen;
}

/** Sorted intersection of `rows` with the drawn copy's rows, if any. */
export function copyRows(
  rows: Uint32Array,
  copy: InstanceCopy | null,
): Uint32Array {
  if (!copy) return rows;
  const out: number[] = [];
  const own = copy.rows;
  let j = 0;
  for (const row of rows) {
    while (j < own.length && own[j] < row) j++;
    if (j < own.length && own[j] === row) out.push(row);
  }
  return Uint32Array.from(out);
}

/** Copies sharing one set of rows: their geometry can be built once. */
export interface CopyGroup {
  readonly rows: Uint32Array;
  readonly copies: readonly InstanceCopy[];
}

const groupsCache = new WeakMap<
  readonly InstanceCopy[],
  readonly CopyGroup[]
>();

/** `copies` grouped by identical row sets, in first-copy order. */
export function copyGroups(
  copies: readonly InstanceCopy[],
): readonly CopyGroup[] {
  const cached = groupsCache.get(copies);
  if (cached) return cached;
  const groups: { rows: Uint32Array; copies: InstanceCopy[] }[] = [];
  for (const copy of copies) {
    const group = groups.find((g) =>
      g.rows.length === copy.rows.length &&
      g.rows.every((row, i) => row === copy.rows[i])
    );
    if (group) group.copies.push(copy);
    else groups.push({ rows: copy.rows, copies: [copy] });
  }
  const frozen = Object.freeze(groups.map((g) => Object.freeze(g)));
  groupsCache.set(copies, frozen);
  return frozen;
}
