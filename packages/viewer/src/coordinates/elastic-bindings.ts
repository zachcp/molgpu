/**
 * Throw a RangeError naming the bytes when a storage binding exceeds the
 * device's binding or buffer size limits.
 */
export function checkElasticBindings(
  bindings: Record<string, number>,
  limits: Pick<
    GPUSupportedLimits,
    "maxStorageBufferBindingSize" | "maxBufferSize"
  >,
): void {
  for (const [name, bytes] of Object.entries(bindings)) {
    const limit = Math.min(
      limits.maxStorageBufferBindingSize,
      limits.maxBufferSize,
    );
    if (bytes > limit) {
      throw new RangeError(
        `<ElasticNetwork> ${name} needs ${bytes} bytes; the device binds at most ${limit}`,
      );
    }
  }
}

/** Default byte budget of the checkpoint ring. */
export const RECORD_BUDGET: number = 64 * 2 ** 20;

/**
 * Checkpoint slot size and count for `nodeCount` nodes. A slot holds x, v and
 * f (36 bytes per node): restoring cached forces keeps a seek bitwise equal
 * to the continuous run. Throws a RangeError naming the bytes when the ring
 * exceeds its budget.
 */
export function checkpointLayout(
  nodeCount: number,
  record: { every: number; checkpoints?: number; maxBytes?: number },
): { slotBytes: number; slots: number } {
  const { every, checkpoints, maxBytes = RECORD_BUDGET } = record;
  if (!Number.isSafeInteger(every) || every < 1) {
    throw new TypeError("record.every must be a positive integer");
  }
  const slotBytes = 36 * nodeCount;
  const slots = checkpoints ?? Math.floor(maxBytes / slotBytes);
  if (!Number.isSafeInteger(slots) || slots < 1) {
    throw new RangeError(
      `<ElasticNetwork> one checkpoint needs ${slotBytes} bytes; the recording budget is ${maxBytes}`,
    );
  }
  if (slots * slotBytes > maxBytes) {
    throw new RangeError(
      `<ElasticNetwork> ${slots} checkpoints need ${
        slots * slotBytes
      } bytes; the recording budget is ${maxBytes}`,
    );
  }
  return { slotBytes, slots };
}
