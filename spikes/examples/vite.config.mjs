// @use-gpu/* ESM default-imports lodash CJS submodules, so vite must pre-bundle them.
// @use-gpu/wgsl ships precompiled .wgsl.js with an export map — do NOT exclude it.
export default {
  server: { port: 5185 },
  optimizeDeps: {
    include: ['@use-gpu/live','@use-gpu/workbench','@use-gpu/webgpu',
              '@use-gpu/core','@use-gpu/shader','@use-gpu/wgsl','lodash'],
    // @use-gpu/glyph loads a Rust/wasm text shaper. Pre-bundling it breaks the
    // wasm init ("cannot read properties of undefined (reading
    // 'userusttext_new')"), so leave it unbundled and let vite serve the wasm.
    exclude: ['@use-gpu/glyph'],
  },
};
