import { assertEquals } from "@std/assert";
import {
  atomicNumberForSymbol,
  ELEMENT_SYMBOL,
  elementSymbolForAtomicNumber,
} from "../src/index.ts";

Deno.test("element identity mappings round-trip and accept source aliases", () => {
  for (
    let atomicNumber = 1;
    atomicNumber < ELEMENT_SYMBOL.length;
    atomicNumber++
  ) {
    const symbol = elementSymbolForAtomicNumber(atomicNumber);
    assertEquals(atomicNumberForSymbol(symbol), atomicNumber, symbol);
  }
  assertEquals(atomicNumberForSymbol("d"), 1);
  assertEquals(atomicNumberForSymbol("T"), 1);
  assertEquals(atomicNumberForSymbol("Nh"), 113);
  assertEquals(atomicNumberForSymbol("Mc"), 115);
  assertEquals(atomicNumberForSymbol("Ts"), 117);
  assertEquals(atomicNumberForSymbol("Og"), 118);
  assertEquals(atomicNumberForSymbol("not-an-element"), 0);
  assertEquals(elementSymbolForAtomicNumber(0), "");
  assertEquals(elementSymbolForAtomicNumber(119), "");
});
