import { type LC, type LiveElement, provide } from "@use-gpu/live";
import {
  CoordinatesContext,
  useCoordinates,
} from "../../src/coordinates/coordinates-context.ts";

/** Forward the nearest coordinate stream without allocating or dispatching. */
export const IdentityCoordinates: LC<{ children?: LiveElement }> = (
  { children },
) => {
  const upstream = useCoordinates();
  return provide(CoordinatesContext, upstream, children ?? null);
};
