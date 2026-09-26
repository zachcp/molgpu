// Vite aliases for every @molgpu workspace package, read from each deno.json's
// exports map, so browser runners follow a package when its entry moves.
const packages = new URL("../packages/", import.meta.url);

/** { '@molgpu/viewer/advanced': '/abs/…/advanced.ts', '@molgpu/viewer': '/abs/…/index.ts', … }.
 * Subpath entries come before their package root: vite matches aliases by prefix, in order. */
export function workspaceAliases() {
  const subpaths = [], roots = [];
  for (const entry of Deno.readDirSync(packages)) {
    if (!entry.isDirectory) continue;
    const path = new URL(`${entry.name}/deno.json`, packages);
    let manifest;
    try {
      manifest = JSON.parse(Deno.readTextFileSync(path));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    const { name, exports } = manifest;
    // Deno accepts the common shorthand `"exports": "./src/index.ts"` as
    // well as a map. Normalize it before iterating; Object.entries(string)
    // would otherwise turn the path into one-character aliases.
    const exportEntries = typeof exports === "string"
      ? [[".", exports]]
      : Object.entries(exports ?? {});
    for (const [subpath, target] of exportEntries) {
      const source = typeof target === "string" ? target : target.import;
      const alias = [
        subpath === "." ? name : `${name}${subpath.slice(1)}`,
        new URL(source, new URL(`${entry.name}/`, packages)).pathname,
      ];
      (subpath === "." ? roots : subpaths).push(alias);
    }
  }
  return Object.fromEntries([...subpaths, ...roots]);
}
