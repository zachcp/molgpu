// Spike stub of the dev-only counters: the real module is ported with the package.
export function count(_name: string, _label: string, _n = 1): void {}
export function gauge(_name: string, _value: number): void {}
export function trackOwnedBuffer(_buffer: GPUBuffer, _label: string): void {}
export function releaseOwnedBuffer(_buffer: GPUBuffer): void {}
