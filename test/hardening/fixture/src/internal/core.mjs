// Upstream helper behind a private adapter, as H4 allows for lower packages.
import { lerp } from "@use-gpu/core/mjs/ease.mjs";
export const mix = (a, b, t) => lerp(a, b, t);
