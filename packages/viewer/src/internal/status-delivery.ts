import { useRef, useResource } from "@use-gpu/live";

/**
 * Deliver each distinct status once, after render, to the latest `onStatus`.
 * Without a callback, `unhandled` runs instead (for example to log a failure
 * once): Live has no error boundary, so failures are reported, never thrown.
 */
export function useStatusDelivery<S>(
  onStatus: ((status: S) => void) | undefined,
  status: S | null,
  unhandled: (status: S) => void,
): void {
  const callback = useRef<((status: S) => void) | undefined>(onStatus);
  callback.current = onStatus;
  useResource(() => {
    if (!status) return;
    if (callback.current) callback.current(status);
    else unhandled(status);
  }, [status]);
}
