// Upstream helper behind a private adapter, as H4 allows for lower packages.
import { lerp } from "@use-gpu/math/mjs/index.mjs";
export const mix = (a, b, t) => lerp(a, b, t);
