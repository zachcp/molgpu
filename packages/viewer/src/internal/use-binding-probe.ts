import { useMemo } from '@use-gpu/live';
import { count } from './instrumentation.ts';

/**
 * Dev-only Live hook (hardening X2): counts one binding update each time any
 * of `deps` changes, including the first render. One useMemo per call; its
 * callback returns after one boolean check while instrumentation is disabled.
 */
export function useBindingProbe(label: string, ...deps: unknown[]): void {
  useMemo(() => count('bindingUpdates', label), deps);
}
