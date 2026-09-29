/** Provenance captured when a GPU-to-CPU copy is submitted. */
export interface ReadbackToken {
  readonly owner: object;
  readonly buffer: GPUBuffer;
  readonly bytes: number;
  readonly layout: unknown;
  readonly generation: number;
}

/** A new owner or layout must get its own first snapshot. */
export function sameReadbackSource(
  a: ReadbackToken | null,
  b: ReadbackToken,
): boolean {
  return a !== null && a.owner === b.owner && a.buffer === b.buffer &&
    a.bytes === b.bytes && a.layout === b.layout;
}

export function sameReadbackToken(
  a: ReadbackToken | null,
  b: ReadbackToken,
): boolean {
  return a !== null && sameReadbackSource(a, b) &&
    a.generation === b.generation;
}
