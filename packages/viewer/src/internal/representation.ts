import { type LiveElement, use, useMemo } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import { compile, type Field } from "@molgpu/fields";
import type { Selection } from "@molgpu/select";
import { activeAtoms } from "@molgpu/table";
import type { ColumnFormat } from "./columns.ts";
import type { StructureResource, ViewerElement } from "../types.ts";
import { ColumnSource } from "./column-source.ts";
import { count } from "./instrumentation.ts";

/** Reject a selection resolved against another structure or in another domain. */
export function checkAtomSelection(
  select: Selection | null | undefined,
  resource: StructureResource,
  who: string,
): void {
  if (
    select != null &&
    (select.dataset !== resource.identity || select.domain !== "atom")
  ) {
    throw new TypeError(`${who} received a foreign or non-atom selection`);
  }
}

/** The atom rows a trace or surface draws: the selection's, else the active
 * model/primary-altloc view. activeAtoms reads topology only, so coordinate
 * edits keep the rows (and everything memoised on their identity). */
export function useActiveRows(
  resource: StructureResource,
  select: Selection | null | undefined,
  who: string,
): Uint32Array {
  checkAtomSelection(select, resource, who);
  return useMemo(
    () =>
      select
        ? select.indices
        : (count("topologyBuilds", `${who.toLowerCase()}:activeAtoms`),
          activeAtoms(resource.data)),
    [resource.identity, resource.topologyRevision, select?.id ?? "active"],
  );
}

/** A @molgpu/fields Field (vs a flat VectorLike colour). */
export const isField = (v: unknown): v is Field =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  typeof (v as Partial<Field>).kind === "string" &&
  !!(v as Partial<Field>).type;

/** The atom attribute columns a colour field reads, to gather alongside geometry. */
export const fieldAttrNames = (field: Field | null): string[] =>
  !field ? [] : compile(field, { target: "link", domain: "atom" }).bindings
    .filter((b) => b.kind === "buffer" && b.id.startsWith("attr:")).map((b) =>
      b.id.slice(5)
    );

/** One CPU column to upload: its key in the resulting source map, data and format. */
export interface ColumnSpec {
  readonly key: string;
  readonly data: Float32Array | Int32Array | Uint32Array;
  readonly format: ColumnFormat;
}
/** Uploaded sources by spec key; a key maps to null when its column is empty. */
export type ColumnMap = Record<string, StorageSource | null>;

/** Fold a list of columns into nested owned sources, then render with the map. */
export function withColumns(
  specs: readonly ColumnSpec[],
  render: (map: ColumnMap) => LiveElement | ViewerElement,
): LiveElement {
  const step = (i: number, acc: ColumnMap): LiveElement =>
    i === specs.length ? render(acc) as LiveElement : use(ColumnSource, {
      data: specs[i].data,
      format: specs[i].format,
      label: specs[i].key,
      render: (source: StorageSource | null) =>
        step(i + 1, { ...acc, [specs[i].key]: source }),
    });
  return step(0, {});
}
