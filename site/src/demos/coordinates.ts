// A worked coordinate provider on the public @molgpu/viewer/advanced API: a
// WGSL kernel moves every atom, and <CoordinateKernel> owns the output buffer,
// advances the generation per dispatch and publishes snapshots below it.
import { type LC, type LiveElement, use } from "@use-gpu/live";
import { wgsl } from "@use-gpu/shader/wgsl";
import { CoordinateKernel, useCoordinates } from "@molgpu/viewer/advanced";

// Links getSize(), then one getter per arg, then getInput(i) for the upstream
// position; writes three floats per atom.
const WOBBLE = wgsl`
@link fn getSize() -> vec2<u32>;
@link fn getPhase() -> f32;
@link fn getAmplitude() -> f32;
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  let p = getInput(i);
  let y = p.y + sin(getPhase() + p.x * 0.4) * getAmplitude();
  output[i * 3u] = p.x;
  output[i * 3u + 1u] = y;
  output[i * 3u + 2u] = p.z;
}
`;

/** Displace atoms along y by a sine of x, driven by `phase`. */
export const WobbleCoordinates: LC<{
  phase: number;
  amplitude?: number;
  children?: LiveElement;
}> = ({ phase, amplitude = 0.8, children }) => {
  const upstream = useCoordinates();
  if (!upstream) return children ?? null;
  return use(CoordinateKernel, {
    upstream,
    shader: WOBBLE,
    args: [phase, amplitude],
    parameterKey: `${phase},${amplitude}`,
    children: children ?? null,
  });
};
