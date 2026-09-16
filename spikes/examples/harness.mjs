// The whole use.gpu bootstrap, once. Every example is just the `body` element
// handed to this: WebGPU device -> canvas -> camera -> render pass -> lights.
import { render, use } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight } from '@use-gpu/workbench';

export function mount(body, { radius = 40, lights = true, bearing = 0.6, pitch = 0.35 } = {}) {
  render(use(WebGPU, {
    fallback: (e) => {
      document.getElementById('err').textContent = 'WebGPU: ' + (e?.message ?? e);
      return null;
    },
    children: use(AutoCanvas, {
      selector: '#stage', samples: 4, backgroundColor: [0.05, 0.06, 0.075, 1],
      children: use(OrbitCamera, {
        bearing, pitch, radius, target: [0, 0, 0],
        // `lights: true` is required on Pass, or light components warn and do nothing.
        children: use(Pass, { lights, children: [
          lights && use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
          lights && use(DirectionalLight, { position: [1, 2, 1.5], color: [1, 1, 1], intensity: 1 }),
          body,
        ].filter(Boolean) }),
      }),
    }),
  }));
}
