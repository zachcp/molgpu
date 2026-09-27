import { fileURLToPath } from "node:url";
import { workspaceAliases } from "../../../../scripts/workspace-aliases.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Builds the typed consumer the way an application would, so the browser
 * check runs against bundled output rather than a dev server's module graph. */
export default {
  root: here("."),
  build: {
    outDir: here("dist"),
    emptyOutDir: true,
    // The fixture reports uncaptured WebGPU errors; a minifier renaming the
    // messages would make those reports harder to read, not faster to run.
    minify: false,
    rollupOptions: {
      output: {
        // Name the lazy parser chunk so the test can prove that a preloaded
        // structure never fetches Mol*, and that a BCIF source does.
        manualChunks: (id) => id.includes("/molstar/") ? "molstar" : undefined,
      },
    },
  },
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
