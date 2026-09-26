import type { StructureData } from "@molgpu/table";
import { count } from "./instrumentation.ts";

/** Numeric atom columns by name, gathered at `rows` (every atom when null). */
export function gatherAtomColumns(
  data: StructureData,
  rows: ArrayLike<number> | null,
  names: readonly string[],
  counter: string,
): Record<string, Float32Array> {
  const atoms = data.topology.atoms as unknown as Record<
    string,
    ArrayLike<number>
  >;
  return Object.fromEntries(names.map((name) => {
    count("gathers", `${counter}:attr:${name}`);
    const column = atoms[name];
    return [
      name,
      rows
        ? Float32Array.from(rows, (i) => column[i])
        : Float32Array.from(column),
    ];
  }));
}
