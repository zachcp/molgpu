import { assertEquals, assertRejects } from "@std/assert";

Deno.test("model catalog reads only valid header ranges", async (t) => {
  const directory = await Deno.makeTempDir();
  const output = `${directory}/catalog.json`;
  const header = new TextEncoder().encode(JSON.stringify({
    "layers.0.weight": {
      dtype: "F32",
      shape: [2, 3],
      data_offsets: [0, 24],
    },
  }));
  const bytes = new Uint8Array(8 + header.length + 24);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(header.length), true);
  bytes.set(header, 8);
  const originalFetch = globalThis.fetch;
  const originalArgs = [...Deno.args];
  try {
    Deno.args.splice(0, Deno.args.length, output, "test/model");
    for (const mode of ["partial", "ignored", "wrong-range", "truncated"]) {
      await t.step(mode, async () => {
        const ranges: string[] = [];
        globalThis.fetch = (input, init) => {
          if (String(input).endsWith(".index.json")) {
            return Promise.resolve(new Response(null, { status: 404 }));
          }
          const range = new Headers(init?.headers).get("Range")!;
          ranges.push(range);
          const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
          const start = Number(from), end = Number(to) + 1;
          return Promise.resolve(
            mode === "ignored" ? new Response(bytes) : new Response(
              bytes.subarray(start, end - (mode === "truncated" ? 1 : 0)),
              {
                status: 206,
                headers: {
                  "Content-Range": mode === "wrong-range"
                    ? `bytes 1-8/${bytes.length}`
                    : `bytes ${start}-${end - 1}/${bytes.length}`,
                },
              },
            ),
          );
        };
        const run = () =>
          import(`../scripts/catalog_model_shapes.ts?test=${mode}`);
        if (mode !== "partial") {
          await assertRejects(
            run,
            Error,
            mode === "truncated"
              ? "truncated range response"
              : "expected HTTP 206",
          );
          assertEquals(await Deno.stat(output).catch(() => null), null);
          return;
        }
        await run();
        const { models } = JSON.parse(await Deno.readTextFile(output));
        assertEquals(models[0].tensors, 1);
        assertEquals(models[0].parameters, 6);
        assertEquals(models[0].bytes, 24);
        assertEquals(models[0].stages, [{
          label: "layers 0",
          matrices: [{ name: "layers.0.weight", shape: [2, 3], dtype: "F32" }],
        }]);
        assertEquals(ranges, ["bytes=0-7", `bytes=8-${7 + header.length}`]);
        await Deno.remove(output);
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    Deno.args.splice(0, Deno.args.length, ...originalArgs);
    await Deno.remove(directory, { recursive: true });
  }
});
