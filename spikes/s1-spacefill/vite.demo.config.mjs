export default {
  build: {
    outDir: 'dist-demo', emptyOutDir: true,
    assetsInlineLimit: 100_000_000,   // inline everything we can
    cssCodeSplit: false,
    rollupOptions: { input: 'demo.html' },
    target: 'esnext',
  },
  optimizeDeps: {
    include: ['@use-gpu/live','@use-gpu/workbench','@use-gpu/webgpu','@use-gpu/core','@use-gpu/shader','@use-gpu/wgsl','lodash'],
  },
};
