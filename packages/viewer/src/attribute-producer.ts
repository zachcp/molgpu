import {
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
} from "@use-gpu/live";
import type { StorageSource, StorageTarget } from "@use-gpu/core";
import type { ShaderModule } from "@use-gpu/shader";
import {
  Compute,
  ComputeBuffer,
  Kernel,
  LoopContext,
} from "@use-gpu/workbench";
import type { AttributeDomain } from "@molgpu/table";
import { type Attributes, AttributesContext } from "./attributes-context.ts";
import { useCoordinates } from "./coordinates-context.ts";
import { useStructureResource } from "./structure-context.ts";
import { AttributeSnapshotBoundary } from "./attribute-snapshot.ts";
import {
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";

const NONE: readonly StorageSource[] = [];

const Published: LC<{
  name: string;
  domain: AttributeDomain;
  kind: "scalar" | "code";
  source: StorageTarget;
  count: number;
  generation: number;
  children: LiveElement;
}> = ({ name, domain, kind, source, count, generation, children }) => {
  const upstream = useContext(AttributesContext) ?? {};
  const repaint = useContext(LoopContext);
  const published = useMemo<StorageSource>(() => ({
    buffer: source.buffer,
    format: "f32",
    length: count,
    size: [count],
    version: generation,
  }), [source.buffer, count, generation]);
  useResource((dispose) => {
    trackOwnedBuffer(source.buffer, `attr:producer:${name}`);
    const wakeups = [16, 50, 100, 200, 400, 800].map((ms) =>
      setTimeout(repaint, ms)
    );
    dispose(() => {
      wakeups.forEach(clearTimeout);
      releaseOwnedBuffer(source.buffer);
      source.buffer.destroy();
    });
  }, [source.buffer]);
  const provenance = `gpu:${name.replace(/^[^:]*:/, "")}` as const;
  const entry = Object.freeze({
    source: published,
    domain,
    kind,
    generation,
    provenance,
  });
  const attributes: Attributes = Object.freeze({ ...upstream, [name]: entry });
  return provide(
    AttributesContext,
    attributes,
    use(AttributeSnapshotBoundary, { name, entry, children }),
  );
};

/** Compute one live f32 attribute and expose it to descendant fields. */
export const AttributeProducer: LC<{
  name: string;
  domain: AttributeDomain;
  kind: "scalar" | "code";
  kernel: ShaderModule;
  args?: unknown[];
  sources?: readonly StorageSource[];
  parameterKey?: string;
  children?: LiveElement;
}> = ({
  name,
  domain,
  kind,
  kernel,
  args = [],
  sources = NONE,
  parameterKey = "",
  children,
}) => {
  const coordinates = useCoordinates();
  const root = useStructureResource();
  const count = domain === "atom"
    ? root.data.topology.atoms.count
    : root.data.topology.residues.count;
  if (
    !/^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/.test(name) &&
    !["formalCharge", "partialCharge", "ssCode"].includes(name)
  ) {
    throw new TypeError(
      "AttributeProducer name must be well-known or namespaced",
    );
  }
  if (!["scalar", "code"].includes(kind)) {
    throw new TypeError("AttributeProducer kind must be scalar or code");
  }
  if (
    (name === "formalCharge" && (domain !== "atom" || kind !== "code")) ||
    (name === "partialCharge" && (domain !== "atom" || kind !== "scalar")) ||
    (name === "ssCode" && (domain !== "residue" || kind !== "code"))
  ) {
    throw new TypeError(
      `AttributeProducer ${name} has the wrong domain or kind`,
    );
  }
  if (!coordinates || !count) return children ?? null;
  const linked = useMemo(() => [...sources], [...sources]);
  const next = useRef(0);
  const generation = useMemo(() => ++next.current, [
    coordinates.source,
    coordinates.generation,
    kernel,
    parameterKey,
    ...sources,
  ]);
  const output = () =>
    use(Compute, {
      immediate: true,
      children: use(Kernel, {
        shader: kernel,
        source: coordinates.source,
        sources: linked,
        args,
        initial: true,
        version: generation,
        size: [count, 1],
      }),
    });
  return use(ComputeBuffer, {
    width: count,
    height: 1,
    format: "f32",
    label: `molgpu:attr:producer:${name}`,
    children: output,
    then: (source: StorageTarget) =>
      use(Published, {
        name,
        domain,
        kind,
        source,
        count,
        generation,
        children: children ?? null,
      }),
  });
};
