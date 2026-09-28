import { releaseOwnedBuffer } from "./instrumentation.ts";

/** Retire resources after the render pass that last referenced them is submitted. */
export function retireBuffers(
  device: GPUDevice,
  buffers: readonly GPUBuffer[],
): void {
  const destroy = () => {
    for (const buffer of buffers) {
      releaseOwnedBuffer(buffer);
      buffer.destroy();
    }
  };
  const waitForQueue = () => {
    // A cleanup can run before the current frame's ColorPass is submitted.
    // The queue fence must therefore be taken after a following frame.
    void device.queue.onSubmittedWorkDone().then(destroy, destroy);
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(waitForQueue, 0))
    );
  } else {
    setTimeout(waitForQueue, 0);
  }
}
