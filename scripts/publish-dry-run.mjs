#!/usr/bin/env node
// Dry-run `npm publish` for every workspace package in dependency order, so a
// package is always checked after everything it depends on. Nothing is uploaded.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const ORDER = ['table', 'geo', 'timeline', 'select', 'fields', 'io', 'viewer'];

const manifest = (name) => JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url)));
const version = manifest('table').version;
for (const name of ORDER) {
  const m = manifest(name);
  if (m.version !== version) throw new Error(`${m.name} is ${m.version}, expected ${version} (packages release in lockstep)`);
  const deps = Object.keys({ ...m.dependencies, ...m.peerDependencies }).filter(d => d.startsWith('@molgpu/'));
  for (const d of deps) {
    if (ORDER.indexOf(d.slice('@molgpu/'.length)) >= ORDER.indexOf(name)) throw new Error(`${m.name} depends on ${d}, which is not earlier in ORDER`);
  }
  process.stdout.write(`\n== ${m.name}@${m.version}\n`);
  execFileSync('npm', ['publish', '--dry-run', '--access', 'public', '--workspace', `packages/${name}`], { stdio: 'inherit' });
}
process.stdout.write(`\nAll ${ORDER.length} packages pass npm publish --dry-run at ${version}.\n`);
