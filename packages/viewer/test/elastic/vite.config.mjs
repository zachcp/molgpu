import { fromFileUrl } from "@std/path";
import {
  coverageBuild,
  workspaceAliases,
} from "../../../../scripts/workspace-aliases.mjs";

const here = (p) => fromFileUrl(new URL(p, import.meta.url));

/** Builds the <ElasticNetwork> harness the way an application would. */
export default {
  root: here("."),
  build: coverageBuild({
    outDir: here("dist"),
    emptyOutDir: true,
    minify: false,
  }),
  resolve: {
    alias: workspaceAliases(),
    // Without dedupe a second copy of Live would break context lookups.
    dedupe: [
      "@use-gpu/live",
      "@use-gpu/workbench",
      "@use-gpu/webgpu",
      "@use-gpu/core",
      "@use-gpu/shader",
      "@use-gpu/wgsl",
    ],
  },
};
