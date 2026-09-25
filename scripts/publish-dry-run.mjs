#!/usr/bin/env node
// Dry-run `npm publish` for every workspace package in dependency order, so a
// package is always checked after everything it depends on. Nothing is uploaded.
//
// A version that is already on the registry can't be dry-run published, so
// after a release CI would fail until the next bump. For those versions, this
// checks the tarball with `npm pack --dry-run` instead and says so.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const ORDER = ['table', 'geo', 'timeline', 'select', 'fields', 'io', 'viewer'];

const manifest = (name) => JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url)));

/** 'published', 'unpublished', or 'unknown' (registry unreachable). */
function registryState(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() === version ? 'published' : 'unpublished';
  } catch (err) {
    return /E404|404 Not Found|is not in this registry/.test(String(err.stderr)) ? 'unpublished' : 'unknown';
  }
}

const version = manifest('table').version;
const packedOnly = [];
for (const name of ORDER) {
  const m = manifest(name);
  if (m.version !== version) throw new Error(`${m.name} is ${m.version}, expected ${version} (packages release in lockstep)`);
  const deps = Object.keys({ ...m.dependencies, ...m.peerDependencies }).filter(d => d.startsWith('@molgpu/'));
  for (const d of deps) {
    if (ORDER.indexOf(d.slice('@molgpu/'.length)) >= ORDER.indexOf(name)) throw new Error(`${m.name} depends on ${d}, which is not earlier in ORDER`);
  }
  const state = registryState(m.name, m.version);
  const workspace = ['--workspace', `packages/${name}`];
  process.stdout.write(`\n== ${m.name}@${m.version} (${state})\n`);
  if (state === 'published') {
    packedOnly.push(m.name);
    execFileSync('npm', ['pack', '--dry-run', ...workspace], { stdio: 'inherit' });
  } else {
    execFileSync('npm', ['publish', '--dry-run', '--access', 'public', ...workspace], { stdio: 'inherit' });
  }
}
process.stdout.write(packedOnly.length
  ? `\n${version} is already on the registry for ${packedOnly.join(', ')}: checked with npm pack --dry-run. Bump the version before the next release.\n`
  : `\nAll ${ORDER.length} packages pass npm publish --dry-run at ${version}.\n`);
