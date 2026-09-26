// The "." entry types scene elements with the owned ViewerElement alias so no
// use.gpu type leaks into it (hardening H3). Inside the package every element is
// a use.gpu LiveElement. These two casts mark each crossing between the two.
import type { LiveElement } from "@use-gpu/live";
import type { ViewerElement } from "../types.ts";

/** An owned element (e.g. `children` from props) as the Live element it is. */
export const live = (element: ViewerElement | undefined): LiveElement =>
  element as LiveElement;

/** A Live element returned through the owned ViewerElement type. */
export const viewer = (element: LiveElement): ViewerElement =>
  element as ViewerElement;
