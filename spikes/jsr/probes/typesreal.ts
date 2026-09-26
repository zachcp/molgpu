// Deliberately fails `deno check`: proves use.gpu types are real under Deno, not `any`.
import type { LC } from '@use-gpu/live';
import type { PointLayerProps } from '@use-gpu/workbench';
export const bad: LC<{ n: number }> = 5;
export const bad2: Partial<PointLayerProps> = { shape: 42 };
