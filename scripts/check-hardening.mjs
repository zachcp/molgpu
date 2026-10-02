#!/usr/bin/env -S deno run -A
// Phase 6 hardening checks: automates H1–H6 of docs/HARDENING.md.
//
//   deno run -A scripts/check-hardening.mjs [pkg|dir ...] [--update] [--json] [--usage]
//
// With no arguments every packages/* workspace is checked. A bare name ("geo")
// resolves to packages/geo; anything with a slash is taken as a directory, which
// is how the fixtures under test/hardening are exercised. --update rewrites each
// package's api.txt snapshot (H5) instead of diffing it. Exit status is 1 when
// any criterion fails.
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import ts from "typescript";
import { startRegistry } from "../test/spikes/jsr-consumer/registry.ts";
import { checkPublishedImports } from "./published-imports.mjs";

/** True if `path` exists (file or directory), without the TOCTOU race of a
 * separate stat-then-read; callers still just want a boolean here. */
const exists = (path) => {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
};
const readFile = (path) => Deno.readTextFileSync(path);

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const CRITERIA = ["H1", "H2", "H3", "H4", "H5", "H6"];
const STABILITY = new Set(["stable", "experimental", "advanced"]);
// The one package allowed to depend on use.gpu's component layers and to expose
// native LiveElement in "." and other use.gpu types in advanced. Everything
// else is "lower".
const VIEWER = "@molgpu/viewer";
// Packages that cannot be imported in Node; H6 resolves their entries instead.
const BROWSER_ONLY = new Set([VIEWER]);
const SOURCE = /\.(mjs|js|ts|tsx|mts)$/;

const readJson = (path) => JSON.parse(readFile(path));
const pkgRoot = (spec) =>
  spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : spec.split("/")[0];
// Package sources only ever reach Node builtins through an explicit "node:"
// specifier (Deno resolves nothing else there), so that prefix alone is
// enough to exclude them from the "must be a declared dependency" check.
const isBare = (spec) =>
  !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("node:");

function walk(dir, filter, out = []) {
  if (!exists(dir)) return out;
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) walk(path, filter, out);
    else if (filter.test(entry.name)) out.push(path);
  }
  return out;
}

const DECLARATION_OPTIONS = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
};
const isTsSource = (file) => /\.m?ts$/.test(file) && !/\.d\.m?ts$/.test(file);

/** A file's public declarations: the file itself for .d.ts/JS, or, for TypeScript
 * source, the declarations TS generates from it (isolatedDeclarations makes that
 * a per-file transform). Checks on the public surface read this, never bodies. */
function declarationText(file) {
  const text = readFile(file);
  return isTsSource(file)
    ? ts.transpileDeclaration(text, {
      fileName: file,
      compilerOptions: DECLARATION_OPTIONS,
    }).outputText
    : text;
}

/** Every module specifier a source file references: static, dynamic, re-export, import type. */
function specifiers(file, text = readFile(file)) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) out.push(node.moduleSpecifier.text);
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
    ) out.push(node.arguments[0].text);
    else if (
      ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) out.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const ref of sf.typeReferenceDirectives) out.push(ref.fileName);
  return out;
}

/** Entry points from the exports map: [{ subpath, types, import }]. */
function entries(manifest) {
  const { exports } = manifest;
  if (typeof exports === "string") {
    return [{ subpath: ".", types: exports, import: exports }];
  }
  if (!exports || typeof exports !== "object") return [];
  return Object.entries(exports)
    .filter(([key]) => key.startsWith("."))
    .map(([subpath, target]) =>
      typeof target === "string"
        ? ({ subpath, types: target, import: target })
        : ({ subpath, types: target?.types, import: target?.import })
    );
}

/** Resolve a module's exports with the TS checker: names and printed declarations. */
function moduleExports(file) {
  // TypeScript source is read as its generated declarations, so the API
  // snapshot and the `any` checks see signatures, as a .d.ts would show them.
  const host = ts.createCompilerHost(DECLARATION_OPTIONS);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) =>
    !isTsSource(name) || name.includes("/node_modules/")
      ? read(name, lang, ...rest)
      : ts.createSourceFile(name, declarationText(name), lang, true);
  const program = ts.createProgram([file], DECLARATION_OPTIONS, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  const symbol = sf && checker.getSymbolAtLocation(sf);
  if (!symbol) {
    return Object.assign(new Map(), {
      exportedKeys: new Set(),
      typeRefs: new Map(),
      externalRefs: new Map(),
    }); // not a module
  }
  const out = new Map();
  // Beside the name -> declarations map: which in-package declarations the
  // entry exports, and which in-package types its public declarations use.
  const packageRoot = file.slice(0, file.lastIndexOf("/src/") + 1);
  out.exportedKeys = new Set();
  out.typeRefs = new Map();
  out.externalRefs = new Map(); // export name -> upstream package#symbol references its types reach
  for (const exp of checker.getExportsOfModule(symbol)) {
    const target = exp.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(exp)
      : exp;
    const decls = (target.declarations ?? []).map((d) => {
      // Print the declaring statement, without JSDoc, whitespace-collapsed.
      let node = d;
      while (
        node.parent && !ts.isSourceFile(node.parent) &&
        !ts.isModuleBlock(node.parent)
      ) node = node.parent;
      // Generated and hand-written declarations differ only in `declare`,
      // optional trailing semicolons and commas, parameter-list line breaks and a
      // leading union `|`; normalize them so diffs show API changes.
      return node.getText().replace(/\s+/g, " ").trim().replace(
        /^export declare /,
        "export ",
      ).replace(/;\s*\}/g, " }").replace(/= \| /g, "= ")
        .replace(/\( /g, "(").replace(/,\s*\)/g, ")");
    });
    out.set(exp.name, {
      decls: [...new Set(decls)],
      anyNodes: decls.length ? countAny(target) : 0,
    });
    const external = new Set();
    for (const d of target.declarations ?? []) {
      out.exportedKeys.add(declKey(d, target.name));
      collectTypeRefs(checker, d, packageRoot, out.typeRefs, external);
    }
    if (external.size) out.externalRefs.set(exp.name, [...external]);
  }
  return out;
}

const declKey = (decl, name) => `${decl.getSourceFile().fileName}#${name}`;

/** Record every type a public declaration refers to that is declared inside the
 * package (not another package, a lib file or a type parameter), keyed like
 * declKey, so the caller can check each one is itself exported. */
function collectTypeRefs(
  checker,
  decl,
  packageRoot,
  refs,
  external = new Set(),
  seen = new Set(),
) {
  if (seen.has(decl)) return;
  seen.add(decl);
  const visit = (node) => {
    const nameNode = ts.isTypeReferenceNode(node)
      ? node.typeName
      : ts.isExpressionWithTypeArguments(node)
      ? node.expression
      : null;
    if (nameNode) {
      let symbol = checker.getSymbolAtLocation(nameNode);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
        symbol = checker.getAliasedSymbol(symbol);
      }
      if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
        for (const d of symbol.declarations ?? []) {
          const file = d.getSourceFile().fileName;
          const upstream = file.match(
            /\/node_modules\/(@use-gpu\/[^/]+|@webgpu\/types|molstar)\//,
          );
          if (upstream) external.add(`${upstream[1]}#${symbol.name}`);
          else if (
            file.startsWith(packageRoot) && !file.includes("/node_modules/")
          ) {
            refs.set(declKey(d, symbol.name), symbol.name);
            collectTypeRefs(checker, d, packageRoot, new Map(), external, seen);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(decl);
}

/** Count `any` keywords in a symbol's declarations that lack an explaining comment. */
function countAny(symbol) {
  let n = 0;
  for (const decl of symbol.declarations ?? []) {
    let stmt = decl;
    while (
      stmt.parent && !ts.isSourceFile(stmt.parent) &&
      !ts.isModuleBlock(stmt.parent)
    ) stmt = stmt.parent;
    const text = stmt.getSourceFile().getFullText();
    const leading = ts.getLeadingCommentRanges(text, stmt.getFullStart()) ?? [];
    if (leading.some((r) => /\bany\b/.test(text.slice(r.pos, r.end)))) continue;
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) n++;
      ts.forEachChild(node, visit);
    };
    visit(stmt);
  }
  return n;
}

/** Relative .d.ts files reachable from a declaration entry. */
function declarationClosure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !exists(file)) continue;
    seen.add(file);
    for (const spec of specifiers(file, declarationText(file))) {
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(file), spec);
      const hit = [
        base,
        base.replace(/\.m?js$/, ".d.ts"),
        base.replace(/\.mjs$/, ".d.mts"),
        `${base}.d.ts`,
      ]
        .find((p) => p.endsWith(".ts") && exists(p));
      if (hit) stack.push(hit);
    }
  }
  return [...seen];
}

/** README "## API" table rows: | `name` | stability | ... */
function readmeApi(readme) {
  const section = readme.split(/^## /m).find((s) => /^API\b/.test(s));
  if (!section) return undefined;
  const rows = new Map();
  for (const line of section.split("\n")) {
    const m = line.match(
      /^\|\s*`?([\w$]+)`?\s*\|\s*(\w+)\s*(?:\|\s*(.*?)\s*\|?)?\s*$/,
    );
    if (m) {
      rows.set(m[1], {
        stability: m[2].toLowerCase(),
        description: m[3]?.trim() ?? "",
      });
    }
  }
  return rows;
}

function apiSnapshot(name, apis) {
  const lines = [
    `# ${name} public API — generated by scripts/check-hardening.mjs --update`,
    "",
  ];
  for (const [subpath, api] of apis) {
    lines.push(`## ${subpath}`, "");
    for (const key of [...api.keys()].sort()) {
      lines.push(`${key}`);
      for (const decl of api.get(key).decls) lines.push(`  ${decl}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function workspaceSources() {
  const paths = [
    join(ROOT, "site", "src"),
    join(ROOT, "site", "test"),
    join(ROOT, "test"),
  ];
  for (const entry of Deno.readDirSync(join(ROOT, "packages"))) {
    const base = join(ROOT, "packages", entry.name);
    paths.push(join(base, "src"), join(base, "test"));
  }
  return [...new Set(paths.flatMap((path) => walk(path, SOURCE)))];
}

function consumerFor(file) {
  const packageSource = file.match(/\/packages\/([^/]+)\/src\//);
  if (packageSource) {
    const manifest = join(ROOT, "packages", packageSource[1], "deno.json");
    return {
      type: "package",
      name: exists(manifest) ? readJson(manifest).name : packageSource[1],
    };
  }
  return /\/site\/src\//.test(file) ? { type: "site" } : { type: "tests" };
}

function addUsage(target, exportName, consumer) {
  if (consumer.type === "package" && consumer.name === target.package) return;
  target.uses.get(exportName)?.add(
    consumer.type === "package" ? `package:${consumer.name}` : consumer.type,
  );
}

function identifierUsedOutside(source, name, excluded) {
  let found = false;
  const visit = (node) => {
    if (found || node === excluded) return;
    if (ts.isIdentifier(node) && node.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Summarize which shipped workspace areas consume every public entry export. */
function exportUsage() {
  const targets = [];
  const bySpecifier = new Map();
  const byEntryFile = new Map();
  for (const entry of Deno.readDirSync(join(ROOT, "packages"))) {
    const dir = join(ROOT, "packages", entry.name);
    const manifestPath = join(dir, "deno.json");
    if (!exists(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    for (const entryPoint of entries(manifest)) {
      const file = join(dir, entryPoint.types ?? entryPoint.import ?? "");
      if (!exists(file)) continue;
      const api = moduleExports(file);
      const specifier = entryPoint.subpath === "."
        ? manifest.name
        : `${manifest.name}/${entryPoint.subpath.slice(2)}`;
      const target = {
        package: manifest.name,
        subpath: entryPoint.subpath,
        specifier,
        names: [...api.keys()],
        uses: new Map([...api.keys()].map((name) => [name, new Set()])),
      };
      targets.push(target);
      bySpecifier.set(specifier, target);
      for (const path of new Set([entryPoint.types, entryPoint.import])) {
        if (path) byEntryFile.set(resolve(dir, path), target);
      }
    }
  }

  const targetFor = (specifier, file) =>
    bySpecifier.get(specifier) ??
      (specifier.startsWith(".")
        ? byEntryFile.get(resolve(dirname(file), specifier))
        : undefined);

  for (const file of workspaceSources()) {
    const source = ts.createSourceFile(
      file,
      readFile(file),
      ts.ScriptTarget.Latest,
      true,
    );
    const consumer = consumerFor(file);
    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const target = targetFor(statement.moduleSpecifier.text, file);
        if (!target || !statement.importClause) continue;
        const clause = statement.importClause;
        if (
          clause.name &&
          identifierUsedOutside(source, clause.name.text, statement)
        ) {
          addUsage(target, "default", consumer);
        }
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const specifier of clause.namedBindings.elements) {
            const name = specifier.propertyName?.text ?? specifier.name.text;
            if (
              target.uses.has(name) &&
              identifierUsedOutside(source, specifier.name.text, statement)
            ) addUsage(target, name, consumer);
          }
        } else if (
          clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) &&
          identifierUsedOutside(
            source,
            clause.namedBindings.name.text,
            statement,
          )
        ) {
          // Namespace consumers are reported conservatively: every entry symbol
          // is reachable through the namespace, even if a particular property
          // access is assembled dynamically.
          for (const name of target.names) addUsage(target, name, consumer);
        }
      } else if (
        ts.isExportDeclaration(statement) && statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const target = targetFor(statement.moduleSpecifier.text, file);
        if (!target) continue;
        if (
          statement.exportClause && ts.isNamedExports(statement.exportClause)
        ) {
          for (const specifier of statement.exportClause.elements) {
            addUsage(
              target,
              specifier.propertyName?.text ?? specifier.name.text,
              consumer,
            );
          }
        } else {
          for (const name of target.names) addUsage(target, name, consumer);
        }
      }
      const visitDynamic = (node) => {
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require")) &&
          node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
        ) {
          const target = targetFor(node.arguments[0].text, file);
          if (target) {
            const value = ts.isAwaitExpression(node.parent)
              ? node.parent
              : node;
            const declaration = value.parent;
            if (
              ts.isVariableDeclaration(declaration) &&
              declaration.initializer === value &&
              ts.isObjectBindingPattern(declaration.name) &&
              declaration.name.elements.every((element) =>
                !element.dotDotDotToken &&
                (!element.propertyName ||
                  ts.isIdentifier(element.propertyName) ||
                  ts.isStringLiteral(element.propertyName))
              )
            ) {
              for (const element of declaration.name.elements) {
                const name = element.propertyName?.text ?? element.name.text;
                addUsage(target, name, consumer);
              }
            } else {
              // A namespace or computed access may reach any entry symbol.
              for (const name of target.names) addUsage(target, name, consumer);
            }
          }
        }
        ts.forEachChild(node, visitDynamic);
      };
      visitDynamic(statement);
    }
  }

  return targets.map((target) => ({
    package: target.package,
    subpath: target.subpath,
    exports: target.names.sort().map((name) => {
      const usedBy = [...target.uses.get(name)].sort();
      return {
        name,
        consumers: {
          packages: usedBy.filter((use) => use.startsWith("package:")).map((
            use,
          ) => use.slice(8)),
          site: usedBy.includes("site"),
          tests: usedBy.includes("tests"),
        },
        category: usedBy.length === 0
          ? "none"
          : usedBy.some((use) => use.startsWith("package:") || use === "site")
          ? "workspace"
          : "tests only",
      };
    }),
  }));
}

function wildcardExports(file) {
  const source = ts.createSourceFile(
    file,
    readFile(file),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.filter((node) =>
    ts.isExportDeclaration(node) && node.moduleSpecifier &&
    (node.exportClause === undefined || ts.isNamespaceExport(node.exportClause))
  );
}

function checkPackage(
  dir,
  { update = false, usage = [], published, publishError } = {},
) {
  const fails = Object.fromEntries(CRITERIA.map((c) => [c, []]));
  const fail = (c, msg) => fails[c].push(msg);
  const manifestPath = join(dir, "deno.json");
  if (!exists(manifestPath)) {
    return { name: relative(ROOT, dir), fails: { H1: ["no deno.json"] } };
  }
  const m = readJson(manifestPath);
  const name = m.name ?? relative(ROOT, dir);
  const isViewer = name === VIEWER;
  const isDynamics = name === "@molgpu/dynamics";
  const src = join(dir, "src");
  const sources = walk(src, SOURCE).filter((f) => !f.endsWith(".d.ts"));
  const declared = Object.fromEntries(
    Object.entries(m.imports ?? {}).filter(([key]) => !key.endsWith("/")),
  );
  const ents = entries(m);

  // H1 — manifest.
  for (const key of ["name", "version", "license"]) {
    if (!m[key]) fail("H1", `missing "${key}"`);
  }
  if (m.version && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version)) {
    fail("H1", `version "${m.version}" is not semver`);
  }
  // JSR accepts only a single SPDX identifier, so dynamics declares MIT and
  // ships the PDB2PQR BSD-3-Clause notice as LICENSE-PDB2PQR.
  if (m.license && m.license !== "MIT") {
    fail("H1", `license must be "MIT", got "${m.license}"`);
  }
  if (!exists(join(dir, "LICENSE"))) fail("H1", "missing LICENSE file");
  if (isDynamics && !exists(join(dir, "LICENSE-PDB2PQR"))) {
    fail("H1", "missing LICENSE-PDB2PQR file");
  }
  if (m.private) fail("H1", '"private": true');
  if (!ents.length) fail("H1", '"exports" must be a map with a "." entry');
  else if (!ents.some((e) => e.subpath === ".")) {
    fail("H1", '"exports" has no "." entry');
  }
  for (const e of ents) {
    if (!e.types || !e.import) {
      fail("H1", `exports["${e.subpath}"] needs both "types" and "import"`);
    }
  }
  if (!m.publish?.include?.includes("src")) {
    fail("H1", 'deno.json publish.include must include "src"');
  }
  if (publishError) fail("H1", publishError);
  else if (!published) fail("H1", "package absent from local publish upload");
  else {
    const entryFiles = ents
      .map((e) => e.import)
      .filter((target) => typeof target === "string")
      .map((target) => "/" + target.replace(/^\.\//, ""));
    for (const message of checkPublishedImports(name, published, entryFiles)) {
      fail("H1", message);
    }
  }
  const deno = m;

  if (isDynamics) {
    for (const dep of Object.keys(declared)) {
      if (dep.startsWith("@use-gpu/")) {
        fail("H4", `${name} declares ${dep}; dynamics must be renderer-free`);
      }
    }
  }

  // H2 — declared types match the runtime, per entry.
  const apis = new Map();
  for (const e of ents) {
    const types = e.types && join(dir, e.types);
    const runtime = e.import && join(dir, e.import);
    if (!types || !exists(types)) {
      fail("H2", `exports["${e.subpath}"].types file missing`);
      continue;
    }
    if (!runtime || !exists(runtime)) {
      fail("H2", `exports["${e.subpath}"].import file missing`);
      continue;
    }
    const dts = moduleExports(types);
    const js = moduleExports(runtime);
    apis.set(e.subpath, dts);
    for (const k of js.keys()) {
      if (!dts.has(k)) {
        fail("H2", `${e.subpath}: runtime export "${k}" is not declared`);
      }
    }
    // Type-only exports have no runtime value; only flag declared values missing at runtime.
    for (const [k, v] of dts) {
      const typeOnly = v.decls.every((d) =>
        /^(export )?(declare )?(type|interface) /.test(d)
      );
      if (!typeOnly && !js.has(k)) {
        const implicit = v.decls.every((d) => !d.startsWith("export "));
        fail(
          "H2",
          `${e.subpath}: declared export "${k}" does not exist at runtime` +
            (implicit
              ? " (implicitly exported by the .d.ts; add `export {};` to make the file explicit)"
              : ""),
        );
      }
      if (v.anyNodes) {
        fail(
          "H2",
          `${e.subpath}: "${k}" uses \`any\` without an explaining comment`,
        );
      }
    }
  }

  // H3 — lower packages stay renderer-free. Viewer "." permits only the pinned
  // native LiveElement boundary; other use.gpu types remain advanced.
  for (const e of ents) {
    if (!e.types || !exists(join(dir, e.types))) continue;
    if (isViewer) {
      // The viewer's modules host both "." and advanced exports, so check what
      // each "." export's types reach, not whole files.
      if (e.subpath !== ".") continue;
      for (const [exportName, upstream] of apis.get(".")?.externalRefs ?? []) {
        for (const spec of upstream) {
          if (spec === "@use-gpu/live#LiveElement") continue;
          fail("H3", `"${exportName}" (.) exposes a type from "${spec}"`);
        }
      }
      continue;
    }
    for (const file of declarationClosure(join(dir, e.types))) {
      for (const spec of specifiers(file, declarationText(file))) {
        if (/^(@use-gpu\/|@webgpu\/types|molstar)/.test(spec)) {
          fail("H3", `${relative(dir, file)} references "${spec}"`);
        }
      }
    }
  }

  // H4 — import walls. Mol* is io's real dependency (imported lazily, so
  // bundlers split it out); JSR has no optional peers, so no other package
  // may even declare it.
  if ("molstar" in declared && name !== "@molgpu/io") {
    fail("H4", "only @molgpu/io may depend on molstar");
  }
  for (const file of sources) {
    const rel = relative(dir, file);
    const internal = rel.startsWith(join("src", "internal"));
    for (const spec of specifiers(file)) {
      if (!isBare(spec)) continue;
      if (isDynamics && spec.startsWith("@use-gpu/")) {
        fail("H4", `${rel} imports "${spec}"; dynamics must be renderer-free`);
        continue;
      }
      if (spec.startsWith("molstar") && name !== "@molgpu/io") {
        fail("H4", `${rel} imports Mol* ("${spec}"); only @molgpu/io may`);
      }
      if (spec.startsWith("@use-gpu/") && !isViewer) {
        if (!spec.startsWith("@use-gpu/core")) {
          fail("H4", `${rel} imports "${spec}"; only ${VIEWER} may`);
        } else if (!internal) {
          fail("H4", `${rel} imports "${spec}" outside src/internal/`);
        }
      }
      if (spec.startsWith("@molgpu/") && spec !== pkgRoot(spec)) {
        const sub = `.${spec.slice(pkgRoot(spec).length)}`;
        const target = exists(
            join(ROOT, "packages", pkgRoot(spec).slice(8), "deno.json"),
          )
          ? entries(
            readJson(
              join(ROOT, "packages", pkgRoot(spec).slice(8), "deno.json"),
            ),
          ).map((e) => e.subpath)
          : [];
        if (!target.includes(sub)) {
          fail(
            "H4",
            `${rel} deep-imports "${spec}", which is not an exported entry`,
          );
        }
      }
    }
  }

  // H5 — reviewed API: committed snapshot, and every export classified in the README.
  for (const e of ents) {
    for (const entryFile of new Set([e.types, e.import].filter(Boolean))) {
      if (!exists(join(dir, entryFile))) continue;
      for (const _node of wildcardExports(join(dir, entryFile))) {
        fail(
          "H5",
          `${e.subpath}: wildcard re-export in ${entryFile}; list public names explicitly`,
        );
      }
    }
  }
  if (apis.size) {
    // A public signature may only name types some entry exports: a private
    // alias would appear in the generated docs with nothing to link to.
    const exported = new Set(
      [...apis.values()].flatMap((api) => [...api.exportedKeys]),
    );
    const reported = new Set();
    for (const api of apis.values()) {
      for (const [key, typeName] of api.typeRefs) {
        if (!exported.has(key) && !reported.has(key)) {
          reported.add(key);
          fail(
            "H5",
            `public declarations use "${typeName}", which no entry exports (${
              relative(dir, key.split("#")[0])
            })`,
          );
        }
      }
    }
    const snapshot = apiSnapshot(name, apis);
    const snapPath = join(dir, "api.txt");
    if (update) Deno.writeTextFileSync(snapPath, snapshot);
    else if (!exists(snapPath)) {
      fail("H5", "api.txt missing (run with --update, then review the diff)");
    } else if (readFile(snapPath) !== snapshot) {
      fail("H5", "api.txt is stale (run with --update, then review the diff)");
    }
    const readmePath = join(dir, "README.md");
    const rows = exists(readmePath)
      ? readmeApi(readFile(readmePath))
      : undefined;
    if (!rows) fail("H5", 'README.md has no "## API" section');
    else {
      const usageBySubpath = new Map(
        usage.map((entry) => [
          entry.subpath,
          new Map(entry.exports.map((item) => [item.name, item.category])),
        ]),
      );
      for (const [subpath, api] of apis) {
        for (const k of api.keys()) {
          const row = rows.get(k);
          if (!row) {
            fail("H5", `${subpath}: "${k}" is not classified in README ## API`);
          } else if (!STABILITY.has(row.stability)) {
            fail("H5", `"${k}" has unknown stability "${row.stability}"`);
          } else if (
            row.stability === "advanced" && subpath === "." && isViewer
          ) {
            fail("H5", `"${k}" is advanced but exported from "."`);
          }
          if (
            (usageBySubpath.get(subpath)?.get(k) ?? "none") === "none" &&
            !hasPublicRationale(row?.description)
          ) {
            fail(
              "H5",
              `${subpath}: "${k}" has no in-workspace consumer; document its public purpose in README ## API`,
            );
          }
        }
      }
    }
  }

  // H6 (JSR) — publishable to JSR. Runs last and only on an otherwise clean
  // package, since a manifest or import fault above would fail here too.
  if (deno && CRITERIA.every((c) => !fails[c].length)) {
    jsrCheck(dir, ents, !BROWSER_ONLY.has(m.name), (msg) => fail("H6", msg));
  }
  return { name, dir: relative(ROOT, dir), fails };
}

function hasPublicRationale(description = "") {
  const plain = description.replace(/[\x60*_]/g, "").trim();
  return plain.length >= 12 && !/^(?:-|none|todo|tbd|api)$/i.test(plain);
}

const firstError = (err) =>
  String(err.stderr ?? err.message).split("\n")
    .find((l) => /error|Error/.test(l))?.replace(
      new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
      "",
    )
    .trim() ?? "failed";

/**
 * `deno publish --dry-run` type-checks the package, enforces JSR's no-slow-types
 * rule and resolves every import as JSR will. Then, for packages that run
 * outside a browser, each TypeScript entry is imported under Deno.
 */
function jsrCheck(dir, ents, importable, fail) {
  const deno = (args) => {
    const result = new Deno.Command(Deno.execPath(), {
      args,
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      env: { ...Deno.env.toObject(), NO_COLOR: "1" },
    }).outputSync();
    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    return new TextDecoder().decode(result.stdout);
  };
  try {
    deno(["publish", "--dry-run", "--allow-dirty"]);
  } catch (err) {
    fail(`deno publish --dry-run failed: ${firstError(err)}`);
    return;
  }
  if (!importable) return;
  for (const e of ents.filter((e) => /\.ts$/.test(e.import))) {
    try {
      deno([
        "eval",
        `await import(${
          JSON.stringify(new URL(e.import, `file://${dir}/`).href)
        })`,
      ]);
    } catch (err) {
      fail(`importing ${e.import} under Deno: ${firstError(err)}`);
    }
  }
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const args = argv.filter((a) => !a.startsWith("--"));
  const dirs = args.length
    ? args.map((a) => a.includes("/") ? resolve(a) : join(ROOT, "packages", a))
    : [...Deno.readDirSync(join(ROOT, "packages"))]
      .map((entry) => join(ROOT, "packages", entry.name))
      .filter((d) => exists(join(d, "deno.json")));
  const usage = exportUsage();
  if (flags.has("--usage")) {
    const names = new Set(
      dirs.filter((d) => exists(join(d, "deno.json"))).map((d) =>
        readJson(join(d, "deno.json")).name
      ),
    );
    const selected = usage.filter((entry) => names.has(entry.package));
    if (flags.has("--json")) console.log(JSON.stringify(selected, null, 2));
    else {
      for (const entry of selected) {
        console.log(`\n${entry.package} ${entry.subpath}`);
        for (const item of entry.exports) {
          const consumers = [
            ...item.consumers.packages,
            ...(item.consumers.site ? ["site"] : []),
            ...(item.consumers.tests ? ["tests"] : []),
          ];
          console.log(`  ${item.name}: ${consumers.join(", ") || "none"}`);
        }
      }
    }
    return 0;
  }
  const usageByPackage = new Map();
  for (const entry of usage) {
    const packageUsage = usageByPackage.get(entry.package) ?? [];
    packageUsage.push(entry);
    usageByPackage.set(entry.package, packageUsage);
  }
  // Capture the real unfurled upload without contacting the public registry.
  const registry = startRegistry();
  let publishError;
  try {
    const publishDirs = [
      ROOT,
      ...dirs.filter((dir) => !dir.startsWith(join(ROOT, "packages") + "/")),
    ];
    for (const cwd of publishDirs) {
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["publish", "--token", "local", "--allow-dirty"],
        cwd,
        env: { JSR_URL: registry.url, NO_COLOR: "1" },
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!result.success) {
        publishError = `local publish failed: ${
          new TextDecoder().decode(result.stderr)
        }`;
        break;
      }
    }
  } catch (error) {
    publishError = `local publish failed: ${error}`;
  } finally {
    await registry.stop();
  }
  const results = dirs.map((d) => {
    const manifest = exists(join(d, "deno.json"))
      ? readJson(join(d, "deno.json"))
      : {};
    return checkPackage(d, {
      update: flags.has("--update"),
      published: registry.files(manifest.name, manifest.version),
      publishError,
      usage: usageByPackage.get(manifest.name) ?? [],
    });
  });
  if (flags.has("--json")) console.log(JSON.stringify(results, null, 2));
  else {for (const r of results) {
      const bad = CRITERIA.filter((c) => r.fails[c]?.length);
      console.log(
        `\n${r.name}  ${
          CRITERIA.map((c) => `${c}:${r.fails[c]?.length ? "✗" : "✓"}`).join(
            " ",
          )
        }`,
      );
      for (const c of bad) {
        for (const msg of r.fails[c]) console.log(`  ${c}  ${msg}`);
      }
    }}
  return results.every((r) => CRITERIA.every((c) => !r.fails[c]?.length))
    ? 0
    : 1;
}

Deno.exit(await main(Deno.args));
