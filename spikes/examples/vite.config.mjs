// @use-gpu/* ESM default-imports lodash CJS submodules, so vite must pre-bundle them.
// @use-gpu/wgsl ships precompiled .wgsl.js with an export map — do NOT exclude it.
import { fileURLToPath } from 'node:url';
import { workspaceAliases } from '../../scripts/workspace-aliases.mjs';

const repo = (p) => fileURLToPath(new URL(p, import.meta.url));

export default {
  server: { port: Number(process.env.PORT) || 5185, fs: { allow: [repo('.'), repo('../../packages')] } },
  resolve: {
    // The workspace packages live outside this spike: alias each entry directly.
    alias: workspaceAliases(),
    // Those packages import @use-gpu/* too. Without dedupe they resolve against
    // the REPO ROOT node_modules while the examples resolve against this one,
    // loading two copies of Live and breaking context lookups.
    dedupe: ['@use-gpu/live', '@use-gpu/workbench', '@use-gpu/webgpu',
             '@use-gpu/core', '@use-gpu/shader', '@use-gpu/wgsl'],
  },
  optimizeDeps: {
    include: ['@use-gpu/live','@use-gpu/workbench','@use-gpu/webgpu',
              '@use-gpu/core','@use-gpu/shader','@use-gpu/wgsl','lodash'],
    // @use-gpu/glyph loads a Rust/wasm text shaper. Pre-bundling it breaks the
    // wasm init ("cannot read properties of undefined (reading
    // 'userusttext_new')"), so leave it unbundled and let vite serve the wasm.
    exclude: ['@use-gpu/glyph'],
  },
};
