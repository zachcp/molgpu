import { assertEquals, assertThrows } from "@std/assert";
import {
  checkElasticBindings,
  checkpointLayout,
  RECORD_BUDGET,
} from "../src/internal/elastic-bindings.ts";

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

Deno.test("checkpoint ring layout: 36 B per node, clamped to a byte budget", () => {
  // 12.5k nodes (100k atoms): 450 kB per checkpoint, 149 in 64 MiB.
  assertEquals(checkpointLayout(12_500, { every: 10 }), {
    slotBytes: 450_000,
    slots: Math.floor(RECORD_BUDGET / 450_000),
  });
  assertEquals(checkpointLayout(100, { every: 5, checkpoints: 3 }).slots, 3);
  assertThrows(
    () => checkpointLayout(12_500, { every: 10, checkpoints: 1000 }),
    RangeError,
    "450000000 bytes",
  );
  assertThrows(
    () => checkpointLayout(1_000_000, { every: 10, maxBytes: 2 ** 20 }),
    RangeError,
    "36000000 bytes",
  );
  assertThrows(() => checkpointLayout(10, { every: 0 }), TypeError);
});
