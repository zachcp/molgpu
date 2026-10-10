import { useContext, useMemo } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";
import { type Field, readsNearestVolume } from "@molgpu/fields";
import type { AttributeDomain } from "@molgpu/table";
import type { StructureResource } from "../types.ts";
import { VolumeContext } from "../volume/volume-context.ts";
import { type FieldPlan, planField } from "./field-plan.ts";
import { indexed } from "../rendering/indexed.ts";

export type { FieldPlan };

/** planField over the resource's rows and the nearest volume, memoised on
 * the field, topology and grid so restyling to a new field is the only
 * trigger for a new annotation column. */
export function useFieldPlan(
  field: Field | null,
  resource: StructureResource,
  who: string,
): FieldPlan {
  const nearest = useContext(VolumeContext);
  const grid = field && readsNearestVolume(field) ? nearest?.grid : undefined;
  return useMemo(
    () => planField(field, resource.data, grid, who),
    [field, resource.identity, resource.topologyRevision, grid, who],
  );
}

/**
 * The `useField` inputs a plan's columns provide, read through `rows` (the
 * atom row each drawn element samples). Atom-domain columns are indexed;
 * residue columns are reached only through the lifted `attr:residue` index.
 */
export function fieldColumns(
  plan: FieldPlan,
  attrSources: Record<string, StorageSource>,
  attrDomains: Record<string, AttributeDomain>,
  annotation: StorageSource | null | undefined,
  rows: ShaderSource | null,
): Record<string, ShaderSource> {
  const inputs: Record<string, ShaderSource> = {};
  for (const name of plan.attrNames) {
    const key = `attr:${name}`;
    inputs[key] = attrDomains[key] === "atom"
      ? indexed(attrSources[key], rows, "f32")
      : attrSources[key];
  }
  if (plan.annotation && annotation) {
    inputs.annotation = indexed(
      annotation,
      rows,
      plan.annotation.format === "vec4<f32>" ? "vec4<f32>" : "f32",
    );
  }
  return inputs;
}
