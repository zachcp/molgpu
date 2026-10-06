import { fileURLToPath } from "node:url";
import { workspaceAliases } from "../scripts/workspace-aliases.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default {
  root: here("."),
  base: process.env.BASE_PATH || "/",
  server: {
    port: Number(process.env.PORT) || 5185,
    fs: { allow: [here("."), here("../packages")] },
  },
  resolve: {
    alias: workspaceAliases(),
    dedupe: [
      "@use-gpu/live",
      "@use-gpu/workbench",
      "@use-gpu/webgpu",
      "@use-gpu/core",
      "@use-gpu/shader",
      "@use-gpu/wgsl",
    ],
  },
  optimizeDeps: {
    include: [
      "@use-gpu/live",
      "@use-gpu/workbench",
      "@use-gpu/webgpu",
      "@use-gpu/core",
      "@use-gpu/shader",
      "@use-gpu/wgsl",
      "@use-gpu/wgsl/scissor/scissor-plane.wgsl",
      "@use-gpu/wgsl/use/types.wgsl",
    ],
    exclude: ["@use-gpu/glyph"],
  },
};
