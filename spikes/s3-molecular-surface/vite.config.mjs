// @use-gpu/* ESM default-imports lodash submodules (CJS), so vite must pre-bundle
// them rather than serve them raw. @use-gpu/wgsl ships precompiled .wgsl.js with an
// export map, so it needs no loader — do NOT exclude it.
export default {
  server: { port: 5183 },
  optimizeDeps: {
    include: [
      '@use-gpu/live', '@use-gpu/workbench', '@use-gpu/webgpu',
      '@use-gpu/core', '@use-gpu/shader', '@use-gpu/wgsl',
      'lodash', 'molstar',
    ],
  },
};
