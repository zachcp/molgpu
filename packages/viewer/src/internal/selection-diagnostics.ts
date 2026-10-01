import type { SelectionStatus } from "../types.ts";

const ids = new WeakMap<object, string>();
let nextId = 0;
/** Diagnostic identity only; never exposes the underlying resource. */
export const selectionSourceId = (object: object): string => {
  let value = ids.get(object);
  if (!value) ids.set(object, value = `selection-source-${++nextId}`);
  return value;
};
const notified = new WeakMap<
  (status: SelectionStatus) => void,
  SelectionStatus
>();
/** CPU framing can be called repeatedly for one immutable source tuple. */
export const notifySelectionStatus = (
  callback: ((status: SelectionStatus) => void) | undefined,
  status: SelectionStatus,
): void => {
  if (callback && notified.get(callback) !== status) {
    notified.set(callback, status);
    callback(status);
  }
};
