#!/usr/bin/env node
// Phase 6 hardening checks: automates H1–H6 of docs/HARDENING.md.
//
//   node scripts/check-hardening.mjs [pkg|dir ...] [--update] [--json]
//
// With no arguments every packages/* workspace is checked. A bare name ("geo")
// resolves to packages/geo; anything with a slash is taken as a directory, which
// is how the fixtures under test/hardening are exercised. --update rewrites each
// package's api.txt snapshot (H5) instead of diffing it. Exit status is 1 when
// any criterion fails.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRITERIA = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
const STABILITY = new Set(['stable', 'experimental', 'advanced']);
// The one package allowed to depend on use.gpu's component layers and to expose
// use.gpu types (from its advanced entry only). Everything else is "lower".
const VIEWER = '@molgpu/viewer';
// Packages that cannot be imported in Node; H6 resolves their entries instead.
const BROWSER_ONLY = new Set([VIEWER]);
const PACKABLE = /^(package\.json|README\.md|LICENSE(\.\w+)?|CHANGELOG\.md|src\/.+)$/;
const SOURCE = /\.(mjs|js|ts|tsx|mts)$/;

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const pkgRoot = spec => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
const isBare = spec => !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:') &&
  !builtinModules.includes(spec.split('/')[0]);

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, filter, out);
    else if (filter.test(entry.name)) out.push(path);
  }
  return out;
}

const DECLARATION_OPTIONS = {
  allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022,
};
const isTsSource = file => /\.m?ts$/.test(file) && !/\.d\.m?ts$/.test(file);

/** A file's public declarations: the file itself for .d.ts/JS, or, for TypeScript
 * source, the declarations TS generates from it (isolatedDeclarations makes that
 * a per-file transform). Checks on the public surface read this, never bodies. */
function declarationText(file) {
  const text = readFileSync(file, 'utf8');
  return isTsSource(file) ? ts.transpileDeclaration(text, { fileName: file, compilerOptions: DECLARATION_OPTIONS }).outputText : text;
}

/** Every module specifier a source file references: static, dynamic, re-export, import type. */
function specifiers(file, text = readFileSync(file, 'utf8')) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) out.push(node.arguments[0].text);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)) out.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const ref of sf.typeReferenceDirectives) out.push(ref.fileName);
  return out;
}

/** Entry points from the exports map: [{ subpath, types, import }]. */
function entries(manifest) {
  const { exports } = manifest;
  if (!exports || typeof exports !== 'object') return [];
  return Object.entries(exports)
    .filter(([key]) => key.startsWith('.'))
    .map(([subpath, target]) => ({ subpath, types: target?.types, import: target?.import }));
}

/**
 * The JSR manifest (deno.json) a package.json implies. package.json is the single
 * source: `npm run sync:deno` writes these fields and H1 checks they match.
 * Internal @molgpu deps resolve through the Deno workspace (JSR rewrites them to
 * jsr: on publish); every other dependency becomes an npm: import at the same range.
 */
function expectedDenoManifest(m) {
  const exports = Object.fromEntries(entries(m).map(e => [e.subpath, e.import]));
  const imports = {};
  for (const [dep, range] of Object.entries({ ...m.dependencies, ...m.peerDependencies }).sort(([a], [b]) => a.localeCompare(b))) {
    if (dep.startsWith('@molgpu/')) continue;
    imports[dep] = `npm:${dep}@${range}`;
    imports[`${dep}/`] = `npm:/${dep}@${range}/`;
  }
  return {
    name: m.name, version: m.version, license: m.license,
    exports: Object.keys(exports).length === 1 && exports['.'] ? exports['.'] : exports,
    ...(Object.keys(imports).length ? { imports } : {}),
  };
}

/** Resolve a module's exports with the TS checker: names and printed declarations. */
function moduleExports(file) {
  // TypeScript source is read as its generated declarations, so the API
  // snapshot and the `any` checks see signatures, as a .d.ts would show them.
  const host = ts.createCompilerHost(DECLARATION_OPTIONS);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) => !isTsSource(name) || name.includes('/node_modules/')
    ? read(name, lang, ...rest)
    : ts.createSourceFile(name, declarationText(name), lang, true);
  const program = ts.createProgram([file], DECLARATION_OPTIONS, host);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  const symbol = sf && checker.getSymbolAtLocation(sf);
  if (!symbol) return Object.assign(new Map(), { exportedKeys: new Set(), typeRefs: new Map() }); // not a module
  const out = new Map();
  // Beside the name -> declarations map: which in-package declarations the
  // entry exports, and which in-package types its public declarations use.
  const packageRoot = file.slice(0, file.lastIndexOf('/src/') + 1);
  out.exportedKeys = new Set();
  out.typeRefs = new Map();
  for (const exp of checker.getExportsOfModule(symbol)) {
    const target = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
    const decls = (target.declarations ?? []).map(d => {
      // Print the declaring statement, without JSDoc, whitespace-collapsed.
      let node = d;
      while (node.parent && !ts.isSourceFile(node.parent) && !ts.isModuleBlock(node.parent)) node = node.parent;
      // Generated and hand-written declarations differ only in `declare`,
      // optional trailing semicolons and a leading union `|`; normalize them so
      // diffs show API changes.
      return node.getText().replace(/\s+/g, ' ').trim().replace(/^export declare /, 'export ').replace(/;\s*\}/g, ' }').replace(/= \| /g, '= ');
    });
    out.set(exp.name, { decls: [...new Set(decls)], anyNodes: decls.length ? countAny(target) : 0 });
    for (const d of target.declarations ?? []) {
      out.exportedKeys.add(declKey(d, target.name));
      collectTypeRefs(checker, d, packageRoot, out.typeRefs);
    }
  }
  return out;
}

const declKey = (decl, name) => `${decl.getSourceFile().fileName}#${name}`;

/** Record every type a public declaration refers to that is declared inside the
 * package (not another package, a lib file or a type parameter), keyed like
 * declKey, so the caller can check each one is itself exported. */
function collectTypeRefs(checker, decl, packageRoot, refs) {
  const visit = node => {
    const nameNode = ts.isTypeReferenceNode(node) ? node.typeName
      : ts.isExpressionWithTypeArguments(node) ? node.expression : null;
    if (nameNode) {
      let symbol = checker.getSymbolAtLocation(nameNode);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      if (symbol && !(symbol.flags & ts.SymbolFlags.TypeParameter)) {
        for (const d of symbol.declarations ?? []) {
          const file = d.getSourceFile().fileName;
          if (file.startsWith(packageRoot) && !file.includes('/node_modules/')) refs.set(declKey(d, symbol.name), symbol.name);
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
    while (stmt.parent && !ts.isSourceFile(stmt.parent) && !ts.isModuleBlock(stmt.parent)) stmt = stmt.parent;
    const text = stmt.getSourceFile().getFullText();
    const leading = ts.getLeadingCommentRanges(text, stmt.getFullStart()) ?? [];
    if (leading.some(r => /\bany\b/.test(text.slice(r.pos, r.end)))) continue;
    const visit = node => { if (node.kind === ts.SyntaxKind.AnyKeyword) n++; ts.forEachChild(node, visit); };
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
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const spec of specifiers(file, declarationText(file))) {
      if (!spec.startsWith('.')) continue;
      const base = resolve(dirname(file), spec);
      const hit = [base, base.replace(/\.m?js$/, '.d.ts'), base.replace(/\.mjs$/, '.d.mts'), `${base}.d.ts`]
        .find(p => p.endsWith('.ts') && existsSync(p));
      if (hit) stack.push(hit);
    }
  }
  return [...seen];
}

/** README "## API" table rows: | `name` | stability | ... */
function readmeApi(readme) {
  const section = readme.split(/^## /m).find(s => /^API\b/.test(s));
  if (!section) return undefined;
  const rows = new Map();
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`?([\w$]+)`?\s*\|\s*(\w+)\s*\|/);
    if (m) rows.set(m[1], m[2].toLowerCase());
  }
  return rows;
}

function apiSnapshot(name, apis) {
  const lines = [`# ${name} public API — generated by scripts/check-hardening.mjs --update`, ''];
  for (const [subpath, api] of apis) {
    lines.push(`## ${subpath}`, '');
    for (const key of [...api.keys()].sort()) {
      lines.push(`${key}`);
      for (const decl of api.get(key).decls) lines.push(`  ${decl}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function checkPackage(dir, { update = false } = {}) {
  const fails = Object.fromEntries(CRITERIA.map(c => [c, []]));
  const fail = (c, msg) => fails[c].push(msg);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return { name: relative(ROOT, dir), fails: { H1: ['no package.json'] } };
  const m = readJson(manifestPath);
  const name = m.name ?? relative(ROOT, dir);
  const isViewer = name === VIEWER;
  const src = join(dir, 'src');
  const sources = walk(src, SOURCE).filter(f => !f.endsWith('.d.ts'));
  const declared = { ...m.dependencies, ...m.peerDependencies };
  const ents = entries(m);

  // H1 — manifest.
  for (const key of ['name', 'version', 'license', 'description']) if (!m[key]) fail('H1', `missing "${key}"`);
  if (m.version && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version)) fail('H1', `version "${m.version}" is not semver`);
  if (m.license && m.license !== 'MIT') fail('H1', `license must be "MIT", got "${m.license}"`);
  if (!existsSync(join(dir, 'LICENSE'))) fail('H1', 'missing LICENSE file');
  if (m.private) fail('H1', '"private": true');
  if (m.type !== 'module') fail('H1', '"type" must be "module"');
  if (!('sideEffects' in m)) fail('H1', 'missing "sideEffects"');
  if (!Array.isArray(m.files) || !m.files.includes('src')) fail('H1', '"files" must include "src"');
  if (!ents.length) fail('H1', '"exports" must be a map with a "." entry');
  else if (!ents.some(e => e.subpath === '.')) fail('H1', '"exports" has no "." entry');
  for (const e of ents) if (!e.types || !e.import) fail('H1', `exports["${e.subpath}"] needs both "types" and "import"`);
  const undeclared = new Set();
  for (const file of sources) for (const spec of specifiers(file)) {
    if (!isBare(spec)) continue;
    const dep = pkgRoot(spec);
    if (dep !== name && !(dep in declared)) undeclared.add(`${dep} (${relative(dir, file)})`);
  }
  for (const u of undeclared) fail('H1', `undeclared import ${u}`);
  for (const [dep, range] of Object.entries(declared)) {
    if (dep.startsWith('@use-gpu/') && !/^\d+\.\d+\.\d+$/.test(range)) fail('H1', `${dep} must be pinned exactly, got "${range}"`);
  }
  const denoPath = join(dir, 'deno.json');
  const deno = existsSync(denoPath) ? readJson(denoPath) : null;
  if (!deno) fail('H1', 'missing deno.json (the JSR manifest; run npm run sync:deno)');
  else {
    const expected = expectedDenoManifest(m);
    for (const key of ['name', 'version', 'license', 'exports', 'imports']) {
      if (JSON.stringify(deno[key]) !== JSON.stringify(expected[key])) fail('H1', `deno.json "${key}" is out of sync with package.json (run npm run sync:deno)`);
    }
    if (!deno.publish?.include?.includes('src')) fail('H1', 'deno.json publish.include must include "src"');
  }
  // Table identity is module-private (a WeakMap brand), so every dependent must
  // share the app's one copy of @molgpu/table rather than install its own.
  if (m.dependencies?.['@molgpu/table']) fail('H1', '@molgpu/table must be a peerDependency, not a dependency');

  // H2 — declared types match the runtime, per entry.
  const apis = new Map();
  for (const e of ents) {
    const types = e.types && join(dir, e.types);
    const runtime = e.import && join(dir, e.import);
    if (!types || !existsSync(types)) { fail('H2', `exports["${e.subpath}"].types file missing`); continue; }
    if (!runtime || !existsSync(runtime)) { fail('H2', `exports["${e.subpath}"].import file missing`); continue; }
    const dts = moduleExports(types);
    const js = moduleExports(runtime);
    apis.set(e.subpath, dts);
    for (const k of js.keys()) if (!dts.has(k)) fail('H2', `${e.subpath}: runtime export "${k}" is not declared`);
    // Type-only exports have no runtime value; only flag declared values missing at runtime.
    for (const [k, v] of dts) {
      const typeOnly = v.decls.every(d => /^(export )?(declare )?(type|interface) /.test(d));
      if (!typeOnly && !js.has(k)) {
        const implicit = v.decls.every(d => !d.startsWith('export '));
        fail('H2', `${e.subpath}: declared export "${k}" does not exist at runtime` +
          (implicit ? ' (implicitly exported by the .d.ts; add `export {};` to make the file explicit)' : ''));
      }
      if (v.anyNodes) fail('H2', `${e.subpath}: "${k}" uses \`any\` without an explaining comment`);
    }
  }

  // H3 — no use.gpu / Mol* types in public declarations (viewer: "." entry only).
  for (const e of ents) {
    if (!e.types || !existsSync(join(dir, e.types))) continue;
    if (isViewer && e.subpath !== '.') continue;
    for (const file of declarationClosure(join(dir, e.types))) {
      for (const spec of specifiers(file, declarationText(file))) {
        if (/^(@use-gpu\/|@webgpu\/types|molstar)/.test(spec)) fail('H3', `${relative(dir, file)} references "${spec}"`);
      }
    }
  }

  // H4 — import walls. Mol* is io's real dependency (imported lazily, so
  // bundlers split it out); JSR has no optional peers, so no other package
  // may even declare it.
  if ('molstar' in declared && name !== '@molgpu/io') fail('H4', 'only @molgpu/io may depend on molstar');
  for (const file of sources) {
    const rel = relative(dir, file);
    const internal = rel.startsWith(join('src', 'internal'));
    for (const spec of specifiers(file)) {
      if (!isBare(spec)) continue;
      if (spec.startsWith('molstar') && name !== '@molgpu/io') fail('H4', `${rel} imports Mol* ("${spec}"); only @molgpu/io may`);
      if (spec.startsWith('@use-gpu/') && !isViewer) {
        if (!spec.startsWith('@use-gpu/core')) fail('H4', `${rel} imports "${spec}"; only ${VIEWER} may`);
        else if (!internal) fail('H4', `${rel} imports "${spec}" outside src/internal/`);
      }
      if (spec.startsWith('@molgpu/') && spec !== pkgRoot(spec)) {
        const sub = `.${spec.slice(pkgRoot(spec).length)}`;
        const target = existsSync(join(ROOT, 'packages', pkgRoot(spec).slice(8), 'package.json'))
          ? entries(readJson(join(ROOT, 'packages', pkgRoot(spec).slice(8), 'package.json'))).map(e => e.subpath) : [];
        if (!target.includes(sub)) fail('H4', `${rel} deep-imports "${spec}", which is not an exported entry`);
      }
    }
  }

  // H5 — reviewed API: committed snapshot, and every export classified in the README.
  if (apis.size) {
    // A public signature may only name types some entry exports: a private
    // alias would appear in the generated docs with nothing to link to.
    const exported = new Set([...apis.values()].flatMap(api => [...api.exportedKeys]));
    const reported = new Set();
    for (const api of apis.values()) for (const [key, typeName] of api.typeRefs) {
      if (!exported.has(key) && !reported.has(key)) { reported.add(key); fail('H5', `public declarations use "${typeName}", which no entry exports (${relative(dir, key.split('#')[0])})`); }
    }
    const snapshot = apiSnapshot(name, apis);
    const snapPath = join(dir, 'api.txt');
    if (update) writeFileSync(snapPath, snapshot);
    else if (!existsSync(snapPath)) fail('H5', 'api.txt missing (run with --update, then review the diff)');
    else if (readFileSync(snapPath, 'utf8') !== snapshot) fail('H5', 'api.txt is stale (run with --update, then review the diff)');
    const readmePath = join(dir, 'README.md');
    const rows = existsSync(readmePath) ? readmeApi(readFileSync(readmePath, 'utf8')) : undefined;
    if (!rows) fail('H5', 'README.md has no "## API" section');
    else for (const [subpath, api] of apis) for (const k of api.keys()) {
      const level = rows.get(k);
      if (!level) fail('H5', `${subpath}: "${k}" is not classified in README ## API`);
      else if (!STABILITY.has(level)) fail('H5', `"${k}" has unknown stability "${level}"`);
      else if (level === 'advanced' && subpath === '.' && isViewer) fail('H5', `"${k}" is advanced but exported from "."`);
    }
  }

  // H6 — pack contents, then import the packed tree in isolation.
  let packed;
  try {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    packed = JSON.parse(out)[0].files.map(f => f.path);
  } catch (err) { fail('H6', `npm pack failed: ${err.message.split('\n')[0]}`); }
  if (packed) {
    for (const f of packed) if (!PACKABLE.test(f)) fail('H6', `tarball would include ${f}`);
    for (const e of ents) for (const f of [e.types, e.import]) {
      if (f && !packed.includes(f.replace(/^\.\//, ''))) fail('H6', `tarball is missing entry file ${f}`);
    }
    // Node won't strip types under node_modules, so only JS entries can be imported
    // from the packed tree; TypeScript entries are imported through Deno below.
    const jsEntries = ents.filter(e => !/\.ts$/.test(e.import));
    if (!fails.H6.length && jsEntries.length) smokeImport(dir, m, jsEntries, packed, msg => fail('H6', msg));
  }
  // H6 (JSR) — publishable to JSR. Runs last and only on an otherwise clean
  // package, since a manifest or import fault above would fail here too.
  if (deno && CRITERIA.every(c => !fails[c].length)) jsrCheck(dir, ents, !BROWSER_ONLY.has(m.name), msg => fail('H6', msg));
  return { name, dir: relative(ROOT, dir), fails };
}

const firstError = (err) => String(err.stderr ?? err.message).split('\n')
  .find(l => /error|Error/.test(l))?.replace(/\x1b\[[0-9;]*m/g, '').trim() ?? 'failed';

/**
 * `deno publish --dry-run` type-checks the package, enforces JSR's no-slow-types
 * rule and resolves every import as JSR will. Then, for packages that run
 * outside a browser, each TypeScript entry is imported under Deno.
 */
function jsrCheck(dir, ents, importable, fail) {
  const deno = (args) => execFileSync('deno', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
  try { deno(['publish', '--dry-run', '--allow-dirty']); }
  catch (err) { fail(`deno publish --dry-run failed: ${firstError(err)}`); return; }
  if (!importable) return;
  for (const e of ents.filter(e => /\.ts$/.test(e.import))) {
    try { deno(['eval', `await import(${JSON.stringify(new URL(e.import, `file://${dir}/`).href)})`]); }
    catch (err) { fail(`importing ${e.import} under Deno: ${firstError(err)}`); }
  }
}

/**
 * Lay the packed files out as node_modules/<name> in a temp dir, link external
 * dependencies (and other @molgpu packages, as they would install) from the
 * repo root, and import each entry from outside the workspace.
 */
function smokeImport(dir, m, ents, packed, fail) {
  const tmp = mkdtempSync(join(tmpdir(), 'molgpu-hardening-'));
  try {
    const target = join(tmp, 'node_modules', ...m.name.split('/'));
    for (const f of packed) {
      mkdirSync(dirname(join(target, f)), { recursive: true });
      writeFileSync(join(target, f), readFileSync(join(dir, f)));
    }
    const rootModules = join(ROOT, 'node_modules');
    for (const entry of readdirSync(rootModules)) {
      if (entry.startsWith('.')) continue;
      const scopes = entry.startsWith('@') ? readdirSync(join(rootModules, entry)).map(s => `${entry}/${s}`) : [entry];
      for (const dep of scopes) {
        if (dep === m.name) continue;
        const link = join(tmp, 'node_modules', dep);
        mkdirSync(dirname(link), { recursive: true });
        if (!existsSync(link)) symlinkSync(join(rootModules, dep), link);
      }
    }
    const browserOnly = BROWSER_ONLY.has(m.name);
    for (const e of ents) {
      const spec = e.subpath === '.' ? m.name : `${m.name}${e.subpath.slice(1)}`;
      const code = browserOnly
        ? `import.meta.resolve(${JSON.stringify(spec)})`
        : `await import(${JSON.stringify(spec)})`;
      try {
        execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: tmp, stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (err) {
        const msg = String(err.stderr ?? err.message).split('\n').find(l => /Error/.test(l)) ?? 'failed';
        fail(`${browserOnly ? 'resolving' : 'importing'} "${spec}" from the packed tree: ${msg.trim()}`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  const flags = new Set(argv.filter(a => a.startsWith('--')));
  const args = argv.filter(a => !a.startsWith('--'));
  const dirs = args.length
    ? args.map(a => a.includes('/') ? resolve(a) : join(ROOT, 'packages', a))
    : readdirSync(join(ROOT, 'packages')).map(p => join(ROOT, 'packages', p)).filter(d => existsSync(join(d, 'package.json')));
  const results = dirs.map(d => checkPackage(d, { update: flags.has('--update') }));
  if (flags.has('--json')) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) {
    const bad = CRITERIA.filter(c => r.fails[c]?.length);
    console.log(`\n${r.name}  ${CRITERIA.map(c => `${c}:${r.fails[c]?.length ? '✗' : '✓'}`).join(' ')}`);
    for (const c of bad) for (const msg of r.fails[c]) console.log(`  ${c}  ${msg}`);
  }
  return results.every(r => CRITERIA.every(c => !r.fails[c]?.length)) ? 0 : 1;
}

export { checkPackage, expectedDenoManifest, CRITERIA };

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
