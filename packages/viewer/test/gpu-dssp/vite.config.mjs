import { fileURLToPath } from "node:url";
import { workspaceAliases } from "../../../../scripts/workspace-aliases.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export default {
  root: here("."),
  publicDir: here("../../../io/test/fixtures"),
  build: { outDir: here("dist"), emptyOutDir: true, minify: false },
  resolve: { alias: workspaceAliases() },
};
