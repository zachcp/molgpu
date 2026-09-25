// The whole use.gpu bootstrap, once. Every example is just the `body` element
// handed to this: WebGPU device -> canvas -> camera -> render pass -> lights.
import { render, use, useState, useResource } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight, useMouseState, useWheelState } from '@use-gpu/workbench';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// A scene/world-space direction. OrbitControls changes only the view; the key
// light never derives from bearing or pitch, so its direction stays fixed.
const WORLD_KEY_DIRECTION = Object.freeze([-1, -2, -1.5]);

/**
 * Drag-to-rotate, wheel-to-zoom wrapper around `OrbitCamera`. `AutoCanvas`
 * (with its default `events: true`) already wires up `DOMEvents` above this
 * in the tree, so `useMouseState`/`useWheelState` are live pointer/wheel
 * state, not a new listener — no manual `addEventListener` needed.
 */
const OrbitControls = ({
  bearing: initialBearing, pitch: initialPitch, radius: initialRadius, target,
  minRadius = 0.5, maxRadius = 5000, minPitch = -1.5, maxPitch = 1.5, children,
}) => {
  const [bearing, setBearing] = useState(initialBearing);
  const [pitch, setPitch] = useState(initialPitch);
  const [radius, setRadius] = useState(initialRadius);

  const mouse = useMouseState();
  const wheel = useWheelState();

  // Runs once per pointer event (mouse/wheel state are new objects each time),
  // not per frame — see `EventStateProvider` in @use-gpu/workbench.
  useResource(() => {
    if (mouse.buttons.left) {
      setBearing((b) => b - mouse.moveX * 0.01);
      setPitch((p) => clamp(p - mouse.moveY * 0.01, minPitch, maxPitch));
    }
  }, [mouse]);

  useResource(() => {
    if (wheel.moveY) {
      setRadius((r) => clamp(r * Math.exp(wheel.moveY * 0.002), minRadius, maxRadius));
    }
  }, [wheel]);

  return use(OrbitCamera, { bearing, pitch, radius, target, children });
};

// `pass` is extra <Pass> props an example opts into, e.g. `{ oit: true }` for
// order-independent transparency so translucent surfaces show what's inside.
export function mount(body, { radius = 40, target = [0, 0, 0], lights = true, bearing = 0.6, pitch = 0.35, cameraComponent, pass } = {}) {
  render(use(WebGPU, {
    fallback: (e) => {
      document.getElementById('err').textContent = 'WebGPU: ' + (e?.message ?? e);
      return null;
    },
    children: use(AutoCanvas, {
      selector: '#stage', samples: 4, backgroundColor: [0.05, 0.06, 0.075, 1],
      children: use(cameraComponent ?? OrbitControls, {
        bearing, pitch, radius, target,
        // `lights: true` is required on Pass, or light components warn and do nothing.
        children: use(Pass, { ...pass, lights, children: [
          lights && use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
          lights && use(DirectionalLight, { direction: WORLD_KEY_DIRECTION, color: [1, 1, 1], intensity: 1 }),
          body,
        ].filter(Boolean) }),
      }),
    }),
  }));
}
