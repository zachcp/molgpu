import { type LC, type LiveElement, useMemo } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import type { StorageSource } from "@use-gpu/core";
import type { Field } from "@molgpu/fields";
import type { StructureData, Trace } from "@molgpu/table";
import { useField } from "../use-field.ts";
import { useAttributeSources } from "./attribute-sources.ts";
import { fieldColumns, type FieldPlan } from "./use-field-plan.ts";
import { useOpacityColors } from "./use-opacity-colors.ts";

/**
 * The atom row each vertex samples: the guide atom of the vertex's trace
 * residue. Atom columns read that atom; residue columns lift through it.
 */
export function vertexAtoms(trace: Trace, residue: Uint32Array): Uint32Array {
  const guide = new Map<number, number>();
  for (let k = 0; k < trace.count; k++) {
    guide.set(trace.residue[k], trace.atom[k]);
  }
  return Uint32Array.from(residue, (row) => guide.get(row)!);
}

/**
 * Evaluate a colour `field` per drawn vertex: positions sample where the
 * vertex is drawn, attributes and annotation rows through `sourceAtom`.
 * Recolouring only rebinds; the geometry columns stay as they are.
 */
export const VertexFieldColors: LC<{
  field: Field;
  positions: StorageSource;
  sourceAtom: StorageSource | null;
  annotation: StorageSource | null;
  data: StructureData;
  plan: FieldPlan;
  opacity: number;
  render: (colors: ShaderSource) => LiveElement;
}> = (
  { field, positions, sourceAtom, annotation, data, plan, opacity, render },
) => {
  const attributes = useAttributeSources(data, plan.attrNames);
  const keys = plan.attrNames.map((name) => `attr:${name}`);
  const inputs = useMemo(() => ({
    positions,
    ...fieldColumns(
      plan,
      attributes.sources,
      attributes.domains,
      annotation,
      sourceAtom,
    ),
  }), [
    positions,
    sourceAtom,
    annotation,
    plan,
    ...keys.map((key) => attributes.sources[key]),
    ...keys.map((key) => attributes.domains[key]),
  ]);
  const colors = useOpacityColors(
    useField(field, inputs, { domain: "atom" }),
    opacity,
  );
  return attributes.ready ? render(colors) : null;
};
