import {
  gather,
  type LiveElement,
  useRef,
  useResource,
  yeet,
} from "@use-gpu/live";

/**
 * Observe one native Kernel's encoded revision, retaining its initial guard.
 * Pinned use.gpu 0.20.0 yields no compute call until its pipeline is ready and
 * exposes no submitted-generation callback. Its count callback distinguishes
 * an encoded dispatch from a suppressed call. ComputePass submits synchronously
 * after the wrapper returns; the microtask publishes after that submission,
 * not after GPU completion. Owners, versions and readiness remain at callers.
 */
export function useDispatchObservation(
  version: number,
  publish: (version: number) => void,
): (kernel: LiveElement, onEncoded?: () => void) => LiveElement {
  const notified = useRef(-1);
  const mounted = useRef(true);
  useResource((dispose) => {
    mounted.current = true;
    dispose(() => {
      mounted.current = false;
    });
  }, []);
  return (kernel, onEncoded) =>
    gather(
      kernel,
      (calls: { compute?: (...args: unknown[]) => unknown }[]) => {
        const call = calls.find((item) => item?.compute);
        return call?.compute
          ? yeet({
            compute: (
              pass: unknown,
              countDispatch: (...args: number[]) => void,
            ) => {
              let encoded = false;
              const result = call.compute!(pass, (...counts: number[]) => {
                encoded = true;
                countDispatch(...counts);
              });
              if (encoded && notified.current !== version) {
                notified.current = version;
                onEncoded?.();
                queueMicrotask(() => {
                  if (mounted.current) publish(version);
                });
              }
              return result;
            },
          })
          : null;
      },
    );
}
