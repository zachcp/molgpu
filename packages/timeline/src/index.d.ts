export type CurveValue = number | readonly number[];
export interface Beat { readonly name: string; readonly time: number }
export interface Timeline {
  readonly unit: 'seconds';
  readonly beats: readonly Beat[];
  time(name: string): number;
}
export function createTimeline(beats: readonly Beat[]): Timeline;
export interface Keyframe<T extends CurveValue> {
  readonly time: number;
  readonly value: T;
  readonly ease?: 'linear' | 'cosine' | 'hold' | 'bezier';
  readonly bezier?: readonly [number, number, number, number];
  readonly knots?: readonly [T, T];
}
export interface Curve<T extends CurveValue> { readonly unit: 'seconds'; readonly type: string; readonly extrapolate: 'clamp' | 'loop' }
export function createCurve<T extends CurveValue>(frames: readonly Keyframe<T>[], options?: {
  readonly type?: 'number' | 'angle';
  readonly automatic?: boolean;
  readonly extrapolate?: 'clamp' | 'loop';
}): Curve<T>;
export function sample<T extends CurveValue>(curve: Curve<T>, time: number): T;
