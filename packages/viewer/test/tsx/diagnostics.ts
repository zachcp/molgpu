/**
 * Test-only instrumentation for the typed consumer. It is a separate module so
 * consumer.tsx stays an ordinary application, and it records the two failure
 * channels a screenshot cannot show: uncaptured WebGPU errors and page errors.
 */
import type { StructureData } from '@molgpu/table';

export type Mode = 'preloaded' | 'empty' | 'siblings' | 'remote' | 'missing' | 'controlled';
export type Phase = 'idle' | 'loading' | 'error' | 'ready';
export interface State { mode: Mode; src: string; mounted: boolean }
/** One in-flight load handed to the test rather than resolved by the fixture. */
export interface Pending { src: string; cancelled: () => boolean; settle: (data: StructureData | null) => void }

export interface Probe {
  mounted: boolean;
  phase: Phase;
  /** Every phase change since the last reset; a final state hides transitions. */
  history: Phase[];
  failure: string | null;
  /** Atom count seen through useStructureResource() when the subtree was ready. */
  atoms: number | null;
  errors: string[];
  pending: Pending[];
  update(patch: Partial<State>): void;
  reset(): void;
  snapshot(): { phase: Phase; history: Phase[]; failure: string | null; atoms: number | null; pending: number; errors: string[] };
  /** Resolve the nth outstanding load; reports whether Live had cancelled it. */
  settle(index: number, which: 'left' | 'right' | null): boolean;
  /** Runtime messages for the prop combinations the type system also rejects. */
  invalid(): string[];
}

export const probe: Probe = {
  mounted: false, phase: 'idle', history: [], failure: null, atoms: null, errors: [], pending: [],
  update: () => {},
  reset: () => { probe.history = []; probe.failure = null; probe.atoms = null; },
  snapshot: () => ({ phase: probe.phase, history: [...probe.history], failure: probe.failure, atoms: probe.atoms, pending: probe.pending.length, errors: [...probe.errors] }),
  settle: () => false,
  invalid: () => [],
};
(globalThis as unknown as { __viewer: Probe }).__viewer = probe;

const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, ...args: Parameters<typeof request>) {
  const device = await request.apply(this, args);
  device.addEventListener('uncapturederror', event => {
    probe.errors.push((event as GPUUncapturedErrorEvent).error.message);
  });
  return device;
};
