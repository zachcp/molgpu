// @ts-self-types="./index.d.ts"
import { mix } from './internal/core.mjs';
export function midpoint(a, b) { return mix(a, b, 0.5); }
