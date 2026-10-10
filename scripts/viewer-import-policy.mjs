// Paths are resolved relative to viewer/src before applying this rule.
const representation = (path) => /(^|\/)representations\//.test(path);

/** Providers and shared mechanics must not depend on visual implementations. */
export function violatesViewerRepresentationBoundary(importer, imported) {
  const from = importer.replaceAll("\\", "/");
  const to = imported.replaceAll("\\", "/");
  if (to.startsWith("../") || to.startsWith("/")) return false;
  if (from === "index.ts" || from === "advanced.ts") return false;
  return representation(to) && !representation(from);
}
