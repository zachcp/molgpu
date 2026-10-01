import { useResource, useState } from "@use-gpu/live";

/** Request-local pending/error state; replacement aborts and suppresses late results. */
export function useSourceRequest<T>(
  load: ((signal: AbortSignal) => T | Promise<T>) | null,
  dependencies: unknown[],
): [T | undefined, unknown, boolean] {
  const [result, setResult] = useState<
    {
      owner: AbortController;
      value?: T;
      error?: unknown;
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
            setResult({ owner: controller, value });
          }
        },
        (error) => {
          if (!controller.signal.aborted) {
            setResult({ owner: controller, error });
          }
        },
      );
    }
    return controller;
  }, dependencies);
  if (!load) return [undefined, undefined, false];
  if (result?.owner !== owner) return [undefined, undefined, true];
  return [result.value, result.error, false];
}
