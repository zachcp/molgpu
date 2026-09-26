#!/usr/bin/env node
// Write each package's deno.json (its JSR manifest) from its package.json, which
// stays the single source for name, version, license, exports and dependency
// ranges. Other deno.json fields (publish, compilerOptions) are kept as they are.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectedDenoManifest } from './check-hardening.mjs';

const packages = new URL('../packages/', import.meta.url).pathname;
for (const name of readdirSync(packages)) {
  const dir = join(packages, name);
  if (!existsSync(join(dir, 'package.json'))) continue;
  const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const path = join(dir, 'deno.json');
  const current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const { imports: _, ...rest } = current;
  const next = { ...rest, ...expectedDenoManifest(m) };
  next.publish ??= { include: ['src', 'README.md', 'LICENSE', 'CHANGELOG.md'] };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { writeFileSync(path, text); console.log(`wrote ${name}/deno.json`); }
}
