import { assert, assertEquals, assertRejects } from "@std/assert";
import { BlockReader, byteSource, urlByteSource } from "../src/byte-source.ts";
import { readInput } from "../src/input.ts";
import { errorFor } from "../src/error.ts";
import {
  openTrajectory,
  structureFromBcif,
  volumeFromCcp4,
} from "../src/index.ts";

const fail = errorFor("bcif");
const bytes = Uint8Array.of(1, 2, 3, 4);
const rangeFetch = (
  change: (call: number, headers: Headers) => Response,
): typeof fetch => {
  let call = 0;
  return ((_url, init) =>
    Promise.resolve(
      change(call++, new Headers(init?.headers)),
    )) as typeof fetch;
};
const response = (
  body = bytes.slice(0, 1),
  range = "bytes 0-0/4",
  etag?: string,
) =>
  new Response(body, {
    status: 206,
    headers: { "content-range": range, ...(etag ? { etag } : {}) },
  });

Deno.test("Range rejects wrong probe offsets, totals and body length", async () => {
  for (
    const result of [
      response(undefined, "bytes 1-1/4"),
      response(undefined, "bytes 0-0/*"),
      response(bytes),
    ]
  ) {
    await assertRejects(() =>
      urlByteSource("https://test/run.xtc", { fetch: rangeFetch(() => result) })
    );
  }
});

Deno.test("Range reads reject wrong offsets, changed totals and changed validators", async () => {
  for (
    const result of [
      response(bytes.slice(1, 3), "bytes 0-1/4", '"a"'),
      response(bytes.slice(1, 3), "bytes 1-2/5", '"a"'),
      response(bytes.slice(1, 3), "bytes 1-2/4", '"b"'),
    ]
  ) {
    const source = await urlByteSource("https://test/run.xtc", {
      fetch: rangeFetch((call, headers) => {
        if (!call) return response(undefined, undefined, '"a"');
        assertEquals(headers.get("if-match"), '"a"');
        return result;
      }),
    });
    await assertRejects(() => source.read(1, 2));
  }
});

Deno.test("Range uses last-modified when no strong ETag and clips reads", async () => {
  const modified = "Tue, 29 Sep 2026 12:00:00 GMT";
  const source = await urlByteSource("https://test/run.xtc", {
    fetch: rangeFetch((call, headers) => {
      const result = call
        ? response(bytes.slice(2), "bytes 2-3/4")
        : response();
      result.headers.set("last-modified", modified);
      if (call) {
        assertEquals(headers.get("if-unmodified-since"), modified);
        assertEquals(headers.get("range"), "bytes=2-3");
      }
      return result;
    }),
  });
  assertEquals(await source.read(2, 99), bytes.slice(2));
  assertEquals(await source.read(4, 99), new Uint8Array());
});

Deno.test("Whole-file loaders propagate fetch abort and retain bytes/Blob parity", async () => {
  for (const input of [bytes, new Blob([bytes])]) {
    assertEquals(await readInput(input, "test", fail), bytes);
  }
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => started = resolve);
  const get = ((_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      assertEquals(init?.signal, controller.signal);
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
      started();
    })) as typeof fetch;
  const loading = structureFromBcif("https://test/data.bcif", {
    signal: controller.signal,
    fetch: get,
  });
  await ready;
  controller.abort();
  assertEquals(await assertRejects(() => loading), controller.signal.reason);
  await assertRejects(() =>
    volumeFromCcp4(bytes, { signal: controller.signal })
  );
  await assertRejects(() =>
    openTrajectory(bytes, { format: "xtc", signal: controller.signal })
  );
});

Deno.test("Header scan aborts custom ByteSource reads and cached blocks; retry is independent", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const reader = new BlockReader(
    {
      size: 4,
      read: (_offset, _length, signal) => {
        seen = signal;
        return Promise.resolve(bytes);
      },
    },
    4,
    controller.signal,
  );
  assertEquals(await reader.bytes(0, 1), bytes.slice(0, 1));
  assertEquals(seen, controller.signal);
  controller.abort();
  await assertRejects(() => reader.bytes(0, 1));
  assertEquals(
    await new BlockReader(byteSource(bytes)).bytes(0, 1),
    bytes.slice(0, 1),
  );
  await assertRejects(() =>
    openTrajectory({
      size: 4,
      read: () => Promise.reject(new Error("scan failed")),
    }, { format: "xtc" })
  );
  const fresh = new AbortController();
  assert(!fresh.signal.aborted);
});
