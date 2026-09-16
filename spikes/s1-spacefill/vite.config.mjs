// @use-gpu/* ESM default-imports lodash CJS submodules, so vite must pre-bundle them.
// @use-gpu/wgsl ships precompiled .wgsl.js with an export map — do NOT exclude it.
export default {
  server: { port: 5184 },
  optimizeDeps: {
    include: ['@use-gpu/live','@use-gpu/workbench','@use-gpu/webgpu','@use-gpu/core','@use-gpu/shader','@use-gpu/wgsl','lodash'],
  },
};
