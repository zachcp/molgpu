/// <reference path="../vite.d.ts" />
import type { StructureData } from "@molgpu/table";
import type { DemoId } from "./registry.ts";
import type { SceneOptions } from "./options.ts";
import { composeScene } from "./examples/compose.tsx";
import { selectScene } from "./examples/select.tsx";
import { surfaceScene } from "./examples/surface.tsx";
import { motionScene } from "./examples/motion.tsx";
import { volumeScene } from "./examples/volume.tsx";
export type * from "./options.ts";
export { selectionFor } from "./examples/select.tsx";
export { clipFrom } from "./examples/surface.tsx";

// Vite inlines each example file's text, so the page shows the code that runs.
const sources = import.meta.glob<string>("./examples/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Each example's file as it runs; the page shows it beside the canvas. */
export const demoSource = (id: DemoId) => {
  const file = `examples/${id}.tsx`;
  return { file, source: sources[`./${file}`] ?? "" };
};

/** Every maintained example stays visible here; each one is public-API JSX. */
export const renderDemoScene = (
  id: DemoId,
  data: StructureData,
  options: SceneOptions,
) => {
  switch (id) {
    case "compose":
      return composeScene(data, options.layers, options.measure);
    case "select":
      return selectScene(data, options);
    case "surface":
      return surfaceScene(data, options);
    case "motion":
      return motionScene(data, options);
    case "volume":
      return volumeScene(data, options);
  }
};
