import { useContext, useMemo } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import type { StorageSource } from "@use-gpu/core";
import {
  attributeColumn,
  type AttributeDomain,
  type StructureData,
} from "@molgpu/table";
import { AttributesContext } from "../attributes/attributes-context.ts";
import { useImmutableAttributeOwner } from "../structure/structure-context.ts";
import { immutableAttributeSource } from "../structure/immutable-attribute-cache.ts";

/** Full-domain f32 columns, shared by representations and overridden by producers. */
export function useAttributeSources(
  data: StructureData,
  names: readonly string[],
): {
  sources: Record<string, StorageSource>;
  domains: Record<string, AttributeDomain>;
  ready: boolean;
} {
  const device = useDeviceContext();
  const owner = useImmutableAttributeOwner();
  const produced = useContext(AttributesContext);
  const key = names.join("\0");
  const columns = names.map((name) => {
    if (produced?.[name]) return null;
    const column = attributeColumn(data, name);
    if (!column) throw new TypeError(`Missing attribute ${name}`);
    return column;
  });
  const entries = useMemo(
    () =>
      columns.map((column) =>
        column ? immutableAttributeSource(owner, device, column) : null
      ),
    [owner, device, key, ...columns],
  );
  return {
    ready: names.every((name) => produced?.[name]?.ready !== false),
    sources: Object.fromEntries(names.map((name, i) => [
      `attr:${name}`,
      produced?.[name]?.source ?? entries[i]!,
    ])),
    domains: Object.fromEntries(names.map((name, i) => [
      `attr:${name}`,
      produced?.[name]?.domain ?? columns[i]!.domain,
    ])),
  };
}
