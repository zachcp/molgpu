// Report which public runtime exports the test suites actually execute.
//
//   deno run -A scripts/browser-coverage-report.mjs <browser-coverage-dir> \
//     [--lcov <unit.lcov>] [--json <out.json>] [--md <out.md>]
//
// <browser-coverage-dir> holds the per-page JSON written by
// scripts/browser-coverage-hook.mjs; --lcov is `deno coverage --lcov` output
// from the unit tests. For every function, variable or class exported by a
// package entry (resolved with `deno doc --json`), the report gives:
//
// - browser: lines of the declaration's body that a browser page executed,
//   mapped from V8 block coverage through each module's inline source map;
// - unit: lines of the body the Deno unit tests executed;
// - named: whether any browser page or browser-suite driver names the export.
//
// A declaration's span runs from its line to the next top-level statement.
// Code that runs at module load (a factory call building a component) counts
// as executed, so `named` is reported alongside to make that visible.
import { fromFileUrl, relative } from "@std/path";

const root = fromFileUrl(new URL("../", import.meta.url));
const args = [...Deno.args];
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
};
const lcovPath = option("--lcov");
const jsonPath = option("--json");
const mdPath = option("--md");
const [browserDir] = args;
if (!browserDir) {
  console.error(
    "usage: browser-coverage-report.mjs <dir> [--lcov f] [--json f] [--md f]",
  );
  Deno.exit(2);
}

// ---- source maps -------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** Decode a v3 `mappings` string to [genLine][] of [genCol, src, origLine]. */
function decodeMappings(mappings) {
  const lines = [];
  let src = 0, origLine = 0, origCol = 0;
  for (const line of mappings.split(";")) {
    const segments = [];
    let genCol = 0;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const values = [];
      let value = 0, shift = 0;
      for (const c of segment) {
        const digit = B64_INDEX[c];
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >> 1) : value >> 1);
          value = 0;
          shift = 0;
        }
      }
      genCol += values[0];
      if (values.length >= 4) {
        src += values[1];
        origLine += values[2];
        origCol += values[3];
        segments.push([genCol, src, origLine]);
      }
    }
    lines.push(segments);
  }
  return lines;
}

function inlineSourceMap(source) {
  const match = source.match(
    /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/,
  );
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---- browser coverage --------------------------------------------------------

/** file -> Map(origLine (1-based) -> executed?) merged across pages. */
const browserLines = new Map();
const suitesByFile = new Map();

function mergeEntry(suite, { url, source, functions }) {
  // A Vite root other than the repository serves workspace files as /@fs/.
  const path = decodeURIComponent(new URL(url).pathname)
    .replace(/^\/@fs\//, "/");
  const map = inlineSourceMap(source);
  if (!map) return;
  // A served module maps to itself; a built bundle (/dist/assets) maps each
  // segment to the original file in the map's `sources`, resolved from the URL.
  const bundle = /\/assets\/[^/]+\.js$/.test(path);
  const own = path.startsWith(root) ? relative(root, path) : path.slice(1);
  const fileOf = (index) => {
    if (!bundle) return own;
    const resolved = new URL(map.sources[index], `file://${path}`).pathname;
    const file = decodeURIComponent(resolved);
    return /\/packages\/[^/]+\/src\//.test(file)
      ? (file.startsWith(root) ? relative(root, file) : file.slice(1))
      : null;
  };
  // Innermost ranges are listed after their parents, so painting in order
  // leaves each byte with its innermost count.
  const counts = new Int32Array(source.length).fill(-1);
  for (const fn of functions) {
    for (const range of fn.ranges) {
      counts.fill(range.count, range.startOffset, range.endOffset);
    }
  }
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const decoded = decodeMappings(map.mappings);
  decoded.forEach((segments, genLine) => {
    const start = lineStarts[genLine];
    if (start === undefined) return;
    for (const [genCol, sourceIndex, origLine] of segments) {
      const count = counts[start + genCol];
      if (count < 0) continue;
      const file = fileOf(sourceIndex);
      if (!file) continue;
      const lines = browserLines.get(file) ?? new Map();
      browserLines.set(file, lines);
      if (!suitesByFile.has(file)) suitesByFile.set(file, new Set());
      suitesByFile.get(file).add(suite);
      const line = origLine + 1;
      lines.set(line, (lines.get(line) ?? false) || count > 0);
    }
  });
}

for await (const entry of Deno.readDir(browserDir)) {
  if (!entry.name.endsWith(".json")) continue;
  const { suite, entries } = JSON.parse(
    await Deno.readTextFile(`${browserDir}/${entry.name}`),
  );
  for (const e of entries) mergeEntry(suite, e);
}

// ---- unit coverage (lcov) ----------------------------------------------------

const unitLines = new Map();
if (lcovPath) {
  let file = null;
  for (const line of (await Deno.readTextFile(lcovPath)).split("\n")) {
    if (line.startsWith("SF:")) {
      file = relative(root, line.slice(3));
      unitLines.set(file, new Map());
    } else if (line.startsWith("DA:") && file) {
      const [n, hits] = line.slice(3).split(",").map(Number);
      unitLines.get(file).set(n, hits > 0);
    }
  }
}

// ---- exports -----------------------------------------------------------------

const RUNTIME = new Set(["function", "variable", "class", "enum"]);
const packages = [...Deno.readDirSync(`${root}/packages`)]
  .filter((d) => d.isDirectory).map((d) => d.name).sort();

async function exportsOf(pkg) {
  const manifest = JSON.parse(
    await Deno.readTextFile(`${root}/packages/${pkg}/deno.json`),
  );
  const entries = typeof manifest.exports === "string"
    ? { ".": manifest.exports }
    : manifest.exports;
  const out = [];
  for (const [entry, path] of Object.entries(entries)) {
    if (!path.endsWith(".ts")) continue;
    const doc = await new Deno.Command("deno", {
      args: ["doc", "--json", `${root}/packages/${pkg}/${path}`],
      stdout: "piped",
      stderr: "null",
    }).output();
    const { nodes } = JSON.parse(new TextDecoder().decode(doc.stdout));
    for (const node of Object.values(nodes)) {
      for (const symbol of node.symbols ?? []) {
        const decl = symbol.declarations.find((d) => RUNTIME.has(d.kind));
        if (!decl) continue;
        out.push({
          pkg,
          entry,
          name: symbol.name,
          kind: decl.kind,
          file: relative(root, fromFileUrl(decl.location.filename)),
          // deno doc locations are 0-based.
          line: decl.location.line + 1,
        });
      }
    }
  }
  return out;
}

const sourceCache = new Map();
const sourceLines = (file) => {
  if (!sourceCache.has(file)) {
    sourceCache.set(file, Deno.readTextFileSync(`${root}/${file}`).split("\n"));
  }
  return sourceCache.get(file);
};

/** [first, last] 1-based lines of the top-level statement starting at `line`. */
function span(file, line) {
  const lines = sourceLines(file);
  let end = line;
  for (let i = line; i < lines.length; i++) {
    const text = lines[i];
    if (/^[A-Za-z@]/.test(text)) break;
    if (/^\/[*/]/.test(text)) break;
    end = i + 1;
  }
  return [line, end];
}

function tally(lines, file, [first, last], skipFirst) {
  const map = lines.get(file);
  if (!map) return null;
  let executable = 0, executed = 0;
  for (let n = skipFirst && last > first ? first + 1 : first; n <= last; n++) {
    if (!map.has(n)) continue;
    executable++;
    if (map.get(n)) executed++;
  }
  return executable ? { executed, executable } : null;
}

// Files a browser page loads or a browser-suite driver runs: every test file
// except Deno unit tests, plus the site source.
const browserText = [];
const walk = (dir) => {
  for (const entry of Deno.readDirSync(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name !== "node_modules" && entry.name !== "results") walk(path);
    } else if (
      /\.(mjs|tsx?|html)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
    ) browserText.push(Deno.readTextFileSync(path));
  }
};
for (const pkg of packages) {
  try {
    walk(`${root}/packages/${pkg}/test`);
  } catch { /* no tests */ }
}
walk(`${root}/site/src`);
walk(`${root}/site/test`);
const corpus = browserText.join("\n");
const named = (name) => new RegExp(`\\b${name}\\b`).test(corpus);

const rows = [];
for (const pkg of packages) {
  for (const e of await exportsOf(pkg)) {
    const s = span(e.file, e.line);
    const text = sourceLines(e.file).slice(s[0] - 1, s[1]).join("\n");
    rows.push({
      ...e,
      span: s,
      // A variable built by a call with no function of its own (a factory
      // such as withGeometryCopies(...)) runs entirely at module load.
      loadTime: e.kind === "variable" && !/=>|\bfunction\b/.test(text) &&
        /\(/.test(text),
      browser: tally(browserLines, e.file, s, true),
      unit: tally(unitLines, e.file, s, true),
      named: named(e.name),
    });
  }
}

const pct = (t) =>
  t
    ? `${
      Math.round(100 * t.executed / t.executable)
    }% (${t.executed}/${t.executable})`
    : "—";
const files = [...browserLines.entries()].map(([file, map]) => {
  const executable = map.size;
  const executed = [...map.values()].filter(Boolean).length;
  return {
    file,
    executed,
    executable,
    suites: [...suitesByFile.get(file)].sort(),
  };
}).sort((a, b) => a.file.localeCompare(b.file));

if (jsonPath) {
  await Deno.writeTextFile(jsonPath, JSON.stringify({ rows, files }, null, 2));
}
const md = [
  "| Package | Entry | Export | Browser body | Unit body | Named by a browser page |",
  "| --- | --- | --- | ---: | ---: | :---: |",
  ...rows.map((r) =>
    `| ${r.pkg} | ${r.entry} | \`${r.name}\` | ${
      r.loadTime ? "load-time" : pct(r.browser)
    } | ${r.loadTime ? "load-time" : pct(r.unit)} | ${r.named ? "yes" : "no"} |`
  ),
  "",
  "| Source file (browser) | Lines executed |",
  "| --- | ---: |",
  ...files.map((f) => `| ${f.file} | ${pct(f)} |`),
].join("\n");
if (mdPath) await Deno.writeTextFile(mdPath, md + "\n");
else console.log(md);
