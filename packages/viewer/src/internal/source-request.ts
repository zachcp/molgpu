import { useResource, useState } from "@use-gpu/live";

/**
 * Outcome of one source request. Rejection is explicit, so any rejection value,
 * including undefined, null, false, 0 or "", is reported unchanged as a failure.
 */
export type SourceOutcome<T> =
  | { readonly state: "idle" }
  | { readonly state: "pending" }
  | { readonly state: "resolved"; readonly value: T }
  | { readonly state: "rejected"; readonly error: unknown };

const IDLE = Object.freeze({ state: "idle" as const });
const PENDING = Object.freeze({ state: "pending" as const });

/** Request-local outcome; replacement aborts and suppresses late results. */
export function useSourceRequest<T>(
  load: ((signal: AbortSignal) => T | Promise<T>) | null,
  dependencies: unknown[],
): SourceOutcome<T> {
  const [result, setResult] = useState<
    {
      readonly owner: AbortController;
      readonly outcome: SourceOutcome<T>;
    } | null
  >(null);
  const owner = useResource((dispose) => {
    const controller = new AbortController();
    dispose(() => controller.abort());
    if (load) {
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return load(controller.signal);
      }).then(
        (value) => {
          if (!controller.signal.aborted) {
            setResult({
              owner: controller,
              outcome: Object.freeze({ state: "resolved", value }),
            });
          }
        },
        (error) => {
          if (!controller.signal.aborted) {
            setResult({
              owner: controller,
              outcome: Object.freeze({ state: "rejected", error }),
            });
          }
        },
      );
    }
    return controller;
  }, dependencies);
  if (!load) return IDLE;
  if (result?.owner !== owner) return PENDING;
  return result.outcome;
}
