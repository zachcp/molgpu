import { defineConfig } from "vite";

/** Emits a separate parser chunk, so its transfer cost is visible and lazy. */
export default defineConfig({
  build: {
    outDir: "packages/io/test/dist",
    emptyOutDir: true,
    lib: {
      entry: "packages/io/test/lazy-entry.mjs",
      formats: ["es"],
      fileName: "bcif-entry",
    },
    rollupOptions: {
      output: { chunkFileNames: "bcif-[hash].js" },
    },
  },
});
