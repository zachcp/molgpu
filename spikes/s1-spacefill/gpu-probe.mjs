// Spike-only instrumentation. Install before requesting a device.
export function installGPUProbe() {
  if (window.__gpuProbe) return window.__gpuProbe;
  const writes = new WeakMap();
  const queues = [];
  const probe = window.__gpuProbe = { submissions: 0, errors: [], drain: () => Promise.all(queues.map(q => q.onSubmittedWorkDone())), writes: b => writes.get(b) ?? 0 };
  if (!globalThis.GPUQueue) return probe;
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (...args) {
    const result = submit.apply(this, args);
    probe.submissions++;
    return result;
  };
  const write = GPUQueue.prototype.writeBuffer;
  GPUQueue.prototype.writeBuffer = function (buffer, ...args) {
    const result = write.call(this, buffer, ...args);
    writes.set(buffer, (writes.get(buffer) ?? 0) + 1);
    return result;
  };
  const request = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await request.apply(this, args);
    queues.push(device.queue);
    device.addEventListener('uncapturederror', e => probe.errors.push(e.error.message));
    device.lost.then(info => { if (info.reason !== 'destroyed') probe.errors.push(`Device lost: ${info.message}`); });
    return device;
  };
  return probe;
}
