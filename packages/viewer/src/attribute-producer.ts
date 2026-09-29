import {
  gather,
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
  yeet,
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
  ready: boolean;
  children: LiveElement;
}> = ({ name, domain, kind, source, count, generation, ready, children }) => {
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
    dispose(() => {
      releaseOwnedBuffer(source.buffer);
      source.buffer.destroy();
    });
  }, [source.buffer]);
  useResource(() => {
    if (ready) repaint();
  }, [ready]);
  const provenance = `gpu:${name.replace(/^[^:]*:/, "")}` as const;
  const entry = Object.freeze({
    source: published,
    domain,
    kind,
    generation,
    ready,
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
  const [submittedGeneration, setSubmittedGeneration] = useState(-1);
  const notified = useRef(-1);
  const mounted = useRef(true);
  useResource((dispose) => {
    mounted.current = true;
    dispose(() => {
      mounted.current = false;
    });
  }, []);
  const ready = submittedGeneration === generation;
  const output = () =>
    use(Compute, {
      immediate: true,
      children: coordinates.ready === false ? null : gather(
        use(Kernel, {
          shader: kernel,
          source: coordinates.source,
          sources: linked,
          args,
          initial: true,
          version: generation,
          size: [count, 1],
        }),
        (calls: { compute?: (...args: unknown[]) => unknown }[]) => {
          const call = calls.find((item) => item?.compute);
          return call?.compute
            ? yeet({
              compute: (
                pass: unknown,
                countDispatch: (...args: number[]) => void,
              ) => {
                let dispatched = false;
                const result = call.compute!(pass, (...counts: number[]) => {
                  dispatched = true;
                  countDispatch(...counts);
                });
                if (dispatched && notified.current !== generation) {
                  notified.current = generation;
                  queueMicrotask(() => {
                    if (mounted.current) setSubmittedGeneration(generation);
                  });
                }
                return result;
              },
            })
            : null;
        },
      ),
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
        ready,
        children: children ?? null,
      }),
  });
};
