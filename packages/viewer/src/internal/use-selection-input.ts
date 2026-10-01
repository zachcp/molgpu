import { useContext, useMemo, useRef, useResource } from "@use-gpu/live";
import { attributeColumn, withAttributes } from "@molgpu/table";
import type { SelectionView } from "@molgpu/select";
import type {
  SelectionDiagnostics,
  SelectionInput,
  SelectionSource,
  SelectionStatus,
} from "../types.ts";
import { useStructureResource } from "../structure-context.ts";
import {
  CoordinateSnapshotContext,
  useCoordinateSnapshot,
} from "../coordinate-snapshot.ts";
import { AttributeSnapshotContext } from "../attribute-snapshot-context.ts";
import { AttributesContext } from "../attributes-context.ts";
import {
  DEFAULT_SELECTION_VIEW,
  resolveSelectionInput,
  type SelectionResolution,
} from "./selection-resolution.ts";

import { selectionSourceId as id } from "./selection-diagnostics.ts";

const layoutId = (layout: unknown): string =>
  layout !== null && typeof layout === "object" ? id(layout) : String(layout);

/** One fixed hook traversal; named dependencies subscribe only to their columns. */
export function useSelectionInput(
  input: SelectionInput | undefined,
  who: string,
  slot: SelectionStatus["slot"] = "select",
  diagnostics: SelectionDiagnostics = {},
  view: SelectionView = DEFAULT_SELECTION_VIEW,
): SelectionResolution {
  const root = useStructureResource();
  const coordinateContext = useContext(CoordinateSnapshotContext);
  const contexts = useContext(AttributeSnapshotContext);
  const produced = useContext(AttributesContext);
  const query = input && !("indices" in input) ? input : null;
  const positions = !!query?.deps.includes("positions");
  const readsAttributes = !!query?.deps.includes("attributes");
  const names = readsAttributes
    ? [
      ...new Set(
        query?.attributes ??
          [...Object.keys(produced ?? {}), ...Object.keys(contexts ?? {})],
      ),
    ].sort()
    : [];
  const snapshots = names.map((name) => contexts?.[name]);
  const snapshot = useCoordinateSnapshot({ enabled: positions });
  useResource((dispose) => {
    const unsubscribe = snapshots.flatMap((context) =>
      context ? [context.subscribe(4, true)] : []
    );
    dispose(() => {
      for (const release of unsubscribe) release();
    });
  }, [names.join("\0"), ...snapshots.map((s) => s?.subscribe)]);

  const complete = useRef<
    {
      key: string;
      value: {
        result: SelectionResolution;
        sources: SelectionSource[];
        updating: boolean;
        stable: boolean;
      };
    } | null
  >(null);
  const raw = useMemo(() => {
    const sources: SelectionSource[] = [{
      kind: "topology",
      owner: id(root),
      source: id(root.data.identity),
      generation: root.topologyRevision,
    }];
    if (readsAttributes && query?.attributes === null) {
      sources.push({
        kind: "attribute",
        name: "*",
        owner: id(root),
        source: id(root.data.identity),
        generation: root.attributesRevision,
      });
    }
    let updating = false;
    let stable = !positions;
    try {
      let data = positions ? snapshot?.data ?? null : root.data;
      if (positions) {
        const token = coordinateContext?.token;
        if (token && token.owner !== root) {
          throw new TypeError("Foreign coordinate snapshot source");
        }
        sources.push({
          kind: "positions",
          owner: id(token?.owner ?? root),
          source: token
            ? `${id(token.buffer)}:${layoutId(token.layout)}:${token.bytes}`
            : id(root.data.identity),
          generation: snapshot?.generation ?? token?.generation ??
            root.positionsRevision,
        });
        updating = !!token && snapshot?.generation !== token.generation;
      }
      let pending = !data;
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const context = snapshots[i];
        const entry = produced?.[name];
        const token = context?.token;
        if (entry || context) {
          stable = false;
          if (!context) {
            throw new TypeError(
              `Produced attribute ${name} has no snapshot boundary`,
            );
          }
          if (token && token.owner !== root) {
            throw new TypeError(`Foreign attribute source ${name}`);
          }
          sources.push({
            kind: "attribute",
            name,
            owner: id(token?.owner ?? root),
            source: token
              ? `${id(token.buffer)}:${layoutId(token.layout)}:${token.bytes}`
              : `${id(entry!.source.buffer)}:${entry!.domain}:${entry!.kind}:${
                entry!.source.length
              }`,
            generation: context.snapshot?.generation ?? token?.generation ??
              entry?.generation ?? 0,
          });
          if (context.error) throw context.error;
          const columnData = context.snapshot?.data;
          if (!columnData) {
            pending = true;
            continue;
          }
          if (
            columnData.identity !== root.identity ||
            columnData.revision.topology !== root.topologyRevision
          ) {
            throw new TypeError(`Foreign or stale attribute snapshot ${name}`);
          }
          const column = attributeColumn(columnData, name);
          if (
            !column || column.domain !== (context.domain ?? entry?.domain) ||
            column.kind !== (context.kind ?? entry?.kind)
          ) {
            throw new TypeError(`Invalid attribute snapshot ${name}`);
          }
          if (data) data = withAttributes(data, { [name]: column });
          updating ||= context.snapshot!.generation !==
            (token?.generation ?? entry?.generation ?? 0);
        } else {
          sources.push({
            kind: "attribute",
            name,
            owner: id(root),
            source: id(root.data.identity),
            generation: root.attributesRevision,
          });
        }
      }
      const result = resolveSelectionInput(
        input,
        root.data,
        pending ? null : data,
        view,
        who,
      );
      return { result, sources, updating, stable };
    } catch (cause) {
      const result: SelectionResolution = {
        status: "error",
        error: new TypeError(`${who} selection failed`, { cause }),
      };
      return { result, sources, updating, stable };
    }
  }, [
    input,
    root,
    snapshot,
    coordinateContext?.token?.owner,
    coordinateContext?.token?.buffer,
    coordinateContext?.token?.layout,
    positions ? coordinateContext?.token?.generation : undefined,
    names.join("\0"),
    ...snapshots.map((s) => s?.snapshot),
    ...snapshots.map((s) => s?.error),
    ...snapshots.map((s) => s?.token?.buffer),
    ...snapshots.map((s) => s?.token?.layout),
    ...names.map((name) => produced?.[name]?.generation),
    view.model,
    view.altloc,
  ]);
  const scopeKey = `${
    input ? id(input) : "default"
  }:${view.model}:${view.altloc}:${root.topologyRevision}:${
    raw.sources.map((source) =>
      `${source.kind}:${source.name}:${source.owner}:${source.source}`
    ).join("|")
  }`;
  let evaluated = raw;
  if (raw.result.status === "ready") {
    complete.current = { key: scopeKey, value: raw };
  } else if (
    raw.result.status === "pending" && complete.current?.key === scopeKey
  ) {
    evaluated = { ...complete.current.value, updating: true };
  } else complete.current = null;
  // Keep callback identity stable when repeated pending renders retain one tuple.
  evaluated = useMemo(() => evaluated, [
    evaluated.result,
    evaluated.updating,
    evaluated.sources,
  ]);
  const status = useMemo<SelectionStatus>(() => ({
    slot,
    label: input?.label ?? "default",
    sources: evaluated.sources,
    consistency: "latest-published",
    ...(evaluated.result.status === "ready"
      ? {
        status: "ready",
        count: evaluated.result.selection.indices.length,
        updating: evaluated.updating,
      }
      : evaluated.result),
  }), [evaluated, slot, input?.label]);
  useResource(() => {
    diagnostics.onSelectionStatus?.(status);
  }, [status, diagnostics.onSelectionStatus]);
  const warned = useRef(new Set<string>());
  useResource(() => {
    if (
      diagnostics.warnEmptySelection && query && evaluated.stable &&
      status.status === "ready" && status.count === 0
    ) {
      const key = `${id(query)}:${
        JSON.stringify(status.sources)
      }:${view.model}:${view.altloc}`;
      if (!warned.current.has(key)) {
        warned.current.add(key);
        console.warn(
          `${who}: empty selection '${query.label}'`,
          query.view,
          view,
        );
      }
    }
  }, [status, diagnostics.warnEmptySelection]);
  return evaluated.result;
}
