import type { ViewerComponent, ViewerElement } from "./types.ts";
/** A compositional boundary only: it never owns a canvas or GPU device. */
export const Molecule: ViewerComponent<{ children?: ViewerElement }> = (
  { children },
) => children;
