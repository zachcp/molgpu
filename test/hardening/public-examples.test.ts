// User-facing examples (README/docs code blocks and the site) must import
// molecular APIs only through published package entries (molgpu-sept-s5o.15).
// Test harnesses and probes under packages/*/test may use internals.
import { assertEquals } from "@std/assert";
import { fromFileUrl, join, relative } from "@std/path";

const root = fromFileUrl(new URL("../../", import.meta.url));

/** Every `@molgpu/<pkg>[/<entry>]` specifier the package manifests export. */
async function publicSpecifiers(): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const entry of Deno.readDir(join(root, "packages"))) {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(root, "packages", entry.name, "deno.json")),
    );
    const exports = typeof manifest.exports === "string"
      ? { ".": manifest.exports }
      : manifest.exports;
    for (const key of Object.keys(exports)) {
      out.add(key === "." ? manifest.name : `${manifest.name}${key.slice(1)}`);
    }
  }
  return out;
}

/** Files under `dir` with one of `exts`, recursively. */
async function* files(dir: string, exts: string[]): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* files(path, exts);
    else if (exts.some((ext) => entry.name.endsWith(ext))) yield path;
  }
}

const SPECIFIER = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;

function molecularImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (
      specifier.startsWith("@molgpu/") ||
      /packages\/[a-z]+\/src/.test(specifier)
    ) {
      found.push(
        specifier.replace(/^jsr:/, "").replace(/@\^?[\d.]+(?=\/|$)/, ""),
      );
    }
  }
  return found;
}

/** Fenced code blocks of a Markdown file. */
function codeBlocks(markdown: string): string {
  return [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)]
    .map((match) => match[1])
    .join("\n");
}

Deno.test("examples import molecular APIs only through public entries", async () => {
  const allowed = await publicSpecifiers();
  const violations: string[] = [];
  const check = (file: string, source: string) => {
    for (const specifier of molecularImports(source)) {
      if (!allowed.has(specifier)) {
        violations.push(`${relative(root, file)}: ${specifier}`);
      }
    }
  };
  const markdown = [join(root, "README.md")];
  for await (const entry of Deno.readDir(join(root, "packages"))) {
    markdown.push(join(root, "packages", entry.name, "README.md"));
  }
  for await (const file of files(join(root, "docs"), [".md"])) {
    markdown.push(file);
  }
  for (const file of markdown) {
    check(file, codeBlocks(await Deno.readTextFile(file)));
  }
  for await (const file of files(join(root, "site", "src"), [".ts", ".tsx"])) {
    check(file, await Deno.readTextFile(file));
  }
  assertEquals(violations, []);
});
