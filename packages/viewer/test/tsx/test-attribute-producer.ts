import { type LC, type LiveElement, use } from "@use-gpu/live";
import { wgsl } from "@use-gpu/shader/wgsl";
import { AttributeProducer } from "@molgpu/viewer/advanced";

const TEST = wgsl`
@link fn getSize() -> vec2<u32>;
@link fn getPhase() -> f32;
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  output[i] = f32(i) + getPhase() + getInput(i).x * 0.0;
}
`;

export const TestAttributeProducer: LC<{
  phase: number;
  name?: string;
  domain?: "atom" | "residue";
  kind?: "scalar" | "code";
  children?: LiveElement;
}> = (
  { phase, name = "gpu:test", domain = "atom", kind = "scalar", children },
) =>
  use(AttributeProducer, {
    name,
    domain,
    kind,
    kernel: TEST,
    args: [phase],
    parameterKey: String(phase),
    children: children ?? null,
  });
