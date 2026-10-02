// Published package source must not carry tracker IDs or project phase
// numbers; they mean nothing to JSR consumers (molgpu-sept-s5o.14).
import { assertEquals } from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";

const root = fromFileUrl(new URL("../../", import.meta.url));
const TRACKER =
  /molgpu-sept-[a-z0-9.]+|\b(?:urn|922|efv|hj0|0lg|s5o|crj|egp|ahc|usx|5td|fch)\.[0-9]+\b|\b(?:Phase|Gate) [0-9]+\b/;

async function* sources(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* sources(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) yield path;
  }
}

Deno.test("published package source carries no tracker or phase references", async () => {
  const found: string[] = [];
  for await (const pkg of Deno.readDir(join(root, "packages"))) {
    for await (const file of sources(join(root, "packages", pkg.name, "src"))) {
      (await Deno.readTextFile(file)).split("\n").forEach((line, i) => {
        if (TRACKER.test(line)) found.push(`${relative(root, file)}:${i + 1}`);
      });
    }
  }
  assertEquals(found, []);
});
