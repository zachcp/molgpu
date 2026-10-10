import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  all,
  allConformers,
  allModels,
  and,
  comp,
  model,
  resolve,
  where,
  within,
} from "@molgpu/select";
import { createStructure, traceTable, withPositions } from "@molgpu/table";
import { resolveSelectionInput } from "../src/selection/selection-resolution.ts";
import { selectionData } from "./fixtures/selection-data.ts";

Deno.test("viewer query defaults and explicit view axes preserve source rows", () => {
  const data = selectionData();
  for (
    const [input, rows] of [
      [null, [0, 2, 3]],
      [all(), [0, 2, 3]],
      [model(2), [4, 6, 7]],
      [and(allModels(), allConformers()), [0, 1, 2, 3, 4, 5, 6, 7]],
      [allConformers(), [0, 1, 2, 3]],
    ] as const
  ) {
    const result = resolveSelectionInput(input, data, data);
    assert(result.status === "ready");
    assertEquals([...result.selection.indices], [...rows]);
  }
  assertEquals(data.topology.atoms.count, 8);
});
Deno.test("resolved selections are exact and topology-bound, not position-bound", () => {
  const data = selectionData();
  const fixed = resolve(all(), data);
  const moved = withPositions(data, new Float32Array(data.positions));
  const result = resolveSelectionInput(fixed, moved, null);
  assert(result.status === "ready");
  assertStrictEquals(result.selection, fixed);
  assertEquals(
    resolveSelectionInput(fixed, selectionData(), data).status,
    "error",
  );
  const stale = {
    ...fixed,
    deps: { ...fixed.deps, topology: data.revision.topology - 1 },
  };
  assertEquals(resolveSelectionInput(stale, data, data).status, "error");
  assertEquals(
    resolveSelectionInput(resolve(comp(["HEM"]), data), data, data).status,
    "error",
  );
});
Deno.test("pending and ready-empty stay distinct; failures contain a named cause", () => {
  const data = selectionData();
  assertEquals(resolveSelectionInput(all(), data, null).status, "pending");
  const empty = resolveSelectionInput(
    where("atom", "empty", () => false),
    data,
    data,
  );
  assert(empty.status === "ready");
  assertEquals(empty.selection.indices.length, 0);
  const failure = resolveSelectionInput(
    where("atom", "bad", () => {
      throw new Error("predicate failed");
    }),
    data,
    data,
    undefined,
    "Spacefill",
  );
  assert(failure.status === "error");
  assertEquals(failure.error.message, "Spacefill selection failed");
  assert(failure.error.cause instanceof Error);
});
Deno.test("scoped within seeds and residue normalization use eligibility throughout", () => {
  const data = selectionData();
  const result = resolveSelectionInput(within(1, comp(["HEM"])), data, data);
  assert(result.status === "ready");
  assertEquals([...result.selection.indices], [2, 3]);
  const residue = resolveSelectionInput(comp(["HEM"]), data, data);
  assert(residue.status === "ready");
  assertEquals(residue.selection.domain, "atom");
  assertEquals([...residue.selection.indices], [2, 3]);
  const full = resolveSelectionInput(all(), data, data, {
    model: "all",
    altloc: "all",
  });
  assert(full.status === "ready");
  assertEquals(full.selection.indices.length, 8);
});

Deno.test("query-selected partial residues require the guide atom for traces", () => {
  const seed = selectionData(true);
  const residue = new Uint32Array(seed.topology.atoms.residue);
  residue[8] = 0;
  const data = createStructure({
    positions: seed.positions,
    topology: {
      ...seed.topology,
      atoms: { ...seed.topology.atoms, residue },
    },
  });
  for (const [row, expected] of [[0, [0]], [8, []]] as const) {
    const result = resolveSelectionInput(
      where("atom", "partial", (_data, i) => i === row, ["topology"]),
      data,
      data,
    );
    assert(result.status === "ready");
    assertEquals([...traceTable(data, result.selection.indices).residue], [
      ...expected,
    ]);
  }
});
