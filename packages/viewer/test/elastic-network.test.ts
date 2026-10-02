import { assertThrows } from "@std/assert";
import { checkElasticBindings } from "../src/internal/elastic-bindings.ts";

Deno.test("elastic bindings above the device limit throw a RangeError naming bytes", () => {
  const limits = {
    maxStorageBufferBindingSize: 128 * 2 ** 20,
    maxBufferSize: 256 * 2 ** 20,
  };
  // 1M atoms at about 100 neighbours per CA node: 50 MB per split CSR buffer.
  checkElasticBindings({ neighbours: 50e6, "rest lengths": 50e6 }, limits);
  assertThrows(
    () => checkElasticBindings({ neighbours: 100e6 + 128 * 2 ** 20 }, limits),
    RangeError,
    "bytes",
  );
  assertThrows(
    () =>
      checkElasticBindings({ state: 2 ** 20 }, {
        maxStorageBufferBindingSize: 2 ** 30,
        maxBufferSize: 2 ** 19,
      }),
    RangeError,
    "state",
  );
});
