import { compile, type Field, readsNearestVolume } from "@molgpu/fields";
import type { StructureData, VolumeGrid } from "@molgpu/table";
import type { ColumnSpec } from "./representation.ts";

/**
 * What an atom colour field reads, compiled against the same nearest-volume
 * grid `useField` lowers it with. A representation gathers `attrNames` from
 * the shared attribute columns and uploads `annotation` (the field's own baked
 * rows) as one column; `useField` binds positions, volumes and time itself.
 */
export interface FieldPlan {
  /** Atom or residue attribute columns, without the `attr:` prefix. */
  readonly attrNames: readonly string[];
  /** Full-domain annotation rows to upload, or null when none is read. */
  readonly annotation: ColumnSpec | null;
}

const NO_FIELD: FieldPlan = Object.freeze({ attrNames: [], annotation: null });

/**
 * Resolve the inputs of `field` for `who`. An argument-free `volumeSample()`
 * compiles against `nearest` and fails without one; any input a representation
 * cannot supply fails here, before a shader is linked.
 */
export function planField(
  field: Field | null,
  data: StructureData,
  nearest: VolumeGrid | undefined,
  who: string,
): FieldPlan {
  if (!field) return NO_FIELD;
  if (readsNearestVolume(field) && !nearest) {
    throw new TypeError(
      `${who} colour field volumeSample() needs a <Volume> or <EField> ancestor`,
    );
  }
  const { bindings } = compile(field, {
    target: "link",
    domain: "atom",
    ...(nearest ? { volume: nearest } : {}),
  });
  const attrNames: string[] = [];
  let annotation: ColumnSpec | null = null;
  for (const binding of bindings) {
    const { id } = binding;
    if (id.startsWith("attr:")) attrNames.push(id.slice(5));
    else if (id === "annotation") {
      annotation = {
        key: "annotation",
        data: binding.fill(data),
        format: binding.wgslType === "vec4<f32>" ? "vec4<f32>" : "f32",
      };
    } else if (
      id !== "positions" && id !== "curve:t" && !id.startsWith("volume:")
    ) {
      throw new TypeError(`${who} colour fields cannot read ${id}`);
    }
  }
  return Object.freeze({ attrNames, annotation });
}
