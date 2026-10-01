// Identity helpers kept for existing adapters; both sides are native LiveElement.
import type { LiveElement } from "@use-gpu/live";
import type { ViewerElement } from "../types.ts";

/** Pass a viewer scene element to Live. */
export const live = (element: ViewerElement | undefined): LiveElement =>
  element;

/** Return a native Live element from a viewer component. */
export const viewer = (element: LiveElement): ViewerElement => element;
