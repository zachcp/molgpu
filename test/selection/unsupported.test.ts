// Every MolQL symbol outside supportedSymbols fails explicitly, at parse time
// in @molgpu/io (with a symbols list) and at compile time in @molgpu/select
// (molgpu-sept-922.20).

import { assert, assertEquals, assertThrows } from "@std/assert";
import { MolScriptSymbolTable } from "molstar/lib/mol-script/language/symbol-table.js";
import { compile, supportedSymbols } from "../../packages/select/src/index.ts";

function molqlSymbols(): string[] {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || (typeof node !== "object" && typeof node !== "function")) {
      return;
    }
    const id = (node as { id?: unknown }).id;
    if (typeof id === "string" && "args" in node) {
      ids.push(id);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!key.startsWith("@")) walk(child);
    }
  };
  walk(MolScriptSymbolTable);
  return ids.filter((id) => !id.startsWith("internal."));
}

Deno.test("supportedSymbols is a subset of Mol*'s MolQL symbol table", () => {
  const all = new Set(molqlSymbols());
  assertEquals(supportedSymbols.filter((s) => !all.has(s)), []);
});

Deno.test("every other MolQL symbol is rejected by name at compile time", () => {
  const supported = new Set(supportedSymbols);
  const others = molqlSymbols().filter((s) => !supported.has(s));
  assert(others.length > 0);
  for (const name of others) {
    // Wrap in a query position so value symbols are rejected by name too.
    assertThrows(
      () => compile({ head: { name } }),
      TypeError,
      `symbol '${name}' is not supported`,
    );
  }
});
