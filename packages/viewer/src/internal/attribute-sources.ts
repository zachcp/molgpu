import { useContext, useMemo, useResource } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import type { StorageSource } from "@use-gpu/core";
import {
  type AttributeColumn,
  attributeColumn,
  type AttributeDomain,
  type StructureData,
} from "@molgpu/table";
import { AttributesContext } from "../attributes-context.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./instrumentation.ts";

const STORAGE = 0x0080;
const COPY_DST = 0x0008;
const COPY_SRC = 0x0004;
interface Entry {
  readonly source: StorageSource;
  refs: number;
}
const devices = new WeakMap<GPUDevice, Map<AttributeColumn, Entry>>();

function acquire(device: GPUDevice, column: AttributeColumn): Entry {
  let columns = devices.get(device);
  if (!columns) devices.set(device, columns = new Map());
  let entry = columns.get(column);
  if (!entry) {
    const values = Float32Array.from(column.values);
    const buffer = device.createBuffer({
      size: Math.max(4, values.byteLength),
      usage: STORAGE | COPY_DST | COPY_SRC,
      label: `molgpu:attribute:${column.name}`,
    });
    if (values.length) device.queue.writeBuffer(buffer, 0, values);
    trackOwnedBuffer(buffer, `attr:${column.name}`);
    count("uploadBytes", `attr:${column.name}`, values.byteLength);
    entry = {
      source: Object.freeze({
        buffer,
        format: "f32",
        length: values.length,
        size: [values.length],
        version: 1,
      }) as StorageSource,
      refs: 0,
    };
    columns.set(column, entry);
  }
  entry.refs++;
  return entry;
}

function release(device: GPUDevice, column: AttributeColumn): void {
  const columns = devices.get(device);
  const entry = columns?.get(column);
  if (!entry || --entry.refs > 0) return;
  columns!.delete(column);
  releaseOwnedBuffer(entry.source.buffer);
  entry.source.buffer.destroy();
}

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
  const produced = useContext(AttributesContext);
  const key = names.join("\0");
  const columns = names.map((name) => {
    if (produced?.[name]) return null;
    const column = attributeColumn(data, name);
    if (!column) throw new TypeError(`Missing attribute ${name}`);
    return column;
  });
  const entries = useMemo(
    () => columns.map((column) => column ? acquire(device, column) : null),
    [device, key, ...columns],
  );
  useResource((dispose) => {
    dispose(() =>
      columns.forEach((column) => {
        if (column) release(device, column);
      })
    );
  }, [entries]);
  return {
    ready: names.every((name) => produced?.[name]?.ready !== false),
    sources: Object.fromEntries(names.map((name, i) => [
      `attr:${name}`,
      produced?.[name]?.source ?? entries[i]!.source,
    ])),
    domains: Object.fromEntries(names.map((name, i) => [
      `attr:${name}`,
      produced?.[name]?.domain ?? columns[i]!.domain,
    ])),
  };
}
