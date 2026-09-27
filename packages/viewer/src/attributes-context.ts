import { type LiveContext, makeContext } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { AttributeDomain, AttributeProvenance } from "@molgpu/table";

export interface ProducedAttribute {
  readonly source: StorageSource;
  readonly domain: AttributeDomain;
  readonly kind: "scalar" | "code";
  readonly generation: number;
  readonly provenance: AttributeProvenance;
}
export type Attributes = Readonly<Record<string, ProducedAttribute>>;
export const AttributesContext: LiveContext<Attributes | undefined> =
  makeContext<Attributes | undefined>(undefined, "AttributesContext");
export const EMPTY_ATTRIBUTES: Attributes = Object.freeze({});
