// The assembly copy a representation is drawing.
import { type LiveContext, makeContext } from "@use-gpu/live";
import type { InstanceCopy } from "./instance-plan.ts";

export type { InstanceCopy };
export { copyRows } from "./instance-plan.ts";

/** The copy a representation is drawing, or null outside any copy. */
export const InstanceContext: LiveContext<InstanceCopy | null> = makeContext<
  InstanceCopy | null
>(null, "InstanceContext");

/**
 * Operators a model-space geometry (Ribbon, Tube, Surface) is drawn under:
 * the geometry is built once and drawn once per copy, or null outside copies.
 */
export const DrawCopiesContext: LiveContext<readonly InstanceCopy[] | null> =
  makeContext<readonly InstanceCopy[] | null>(null, "DrawCopiesContext");
