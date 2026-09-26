// Probe: use.gpu 0.20.0 types and runtime resolution under Deno.
import { lerp, clamp } from '@use-gpu/core/mjs/ease.mjs';
import { makeContext, use, useMemo, type LiveElement, type LC, type LiveContext } from '@use-gpu/live';
import type { ShaderSource } from '@use-gpu/shader';
import { wgsl } from '@use-gpu/shader/wgsl';
import type { PointLayerProps } from '@use-gpu/workbench';

export const Ctx: LiveContext<number | undefined> = makeContext<number | undefined>(undefined, 'Ctx');
const Inner: LC<{ n: number }> = ({ n }) => { const v = useMemo(() => n * 2, [n]); return null; };
export const Outer = (props: { n: number }): LiveElement => use(Inner, props);
const s: ShaderSource | null = null;
const p: Partial<PointLayerProps> = { shape: 'circle' };
const code = wgsl`@export fn f() -> f32 { return 1.0; }`;
console.log('lerp', lerp(0, 10, 0.5), 'clamp', clamp(5, 0, 1), 'wgsl', typeof code, 'use', typeof use, 'point shape', p.shape, s);
