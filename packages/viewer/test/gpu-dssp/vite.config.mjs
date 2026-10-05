import { fromFileUrl } from "@std/path";
import {
  coverageBuild,
  workspaceAliases,
} from "../../../../scripts/workspace-aliases.mjs";

const here = (p) => fromFileUrl(new URL(p, import.meta.url));
export default {
  root: here("."),
  publicDir: here("../../../io/test/fixtures"),
  build: coverageBuild({
    outDir: here("dist"),
    emptyOutDir: true,
    minify: false,
  }),
  resolve: { alias: workspaceAliases() },
};
