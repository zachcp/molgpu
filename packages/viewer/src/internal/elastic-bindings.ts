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
