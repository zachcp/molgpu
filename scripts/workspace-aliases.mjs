// Vite aliases for every @molgpu workspace package, read from each package.json's
// exports map, so browser runners follow a package when its entry moves (for
// example from src/index.mjs to src/index.ts during the TypeScript conversion).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packages = fileURLToPath(new URL('../packages/', import.meta.url));

/** { '@molgpu/viewer/advanced': '/abs/…/advanced.ts', '@molgpu/viewer': '/abs/…/index.ts', … }.
 * Subpath entries come before their package root: vite matches aliases by prefix, in order. */
export function workspaceAliases() {
  const subpaths = [], roots = [];
  for (const dir of readdirSync(packages)) {
    const path = `${packages}${dir}/package.json`;
    if (!existsSync(path)) continue;
    const { name, exports } = JSON.parse(readFileSync(path, 'utf8'));
    for (const [subpath, target] of Object.entries(exports ?? {})) {
      const entry = [subpath === '.' ? name : `${name}${subpath.slice(1)}`, `${packages}${dir}/${target.import.replace(/^\.\//, '')}`];
      (subpath === '.' ? roots : subpaths).push(entry);
    }
  }
  return Object.fromEntries([...subpaths, ...roots]);
}
