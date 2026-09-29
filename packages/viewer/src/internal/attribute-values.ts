import { type AttributeValues, SS_CODES } from "@molgpu/table";

/** Convert the producer's f32 transport into table's semantic column type. */
export function snapshotAttributeValues(
  name: string,
  kind: "scalar" | "code",
  values: Float32Array,
): AttributeValues {
  if (kind === "scalar") {
    values.forEach((value, row) => {
      if (!Number.isFinite(value)) {
        throw new TypeError(`${name}[${row}]: expected finite scalar`);
      }
    });
    return values;
  }
  const lower = name === "ssCode"
    ? 0
    : name === "formalCharge"
    ? -128
    : -16777216;
  const upper = name === "ssCode"
    ? SS_CODES.length - 1
    : name === "formalCharge"
    ? 127
    : 16777216;
  values.forEach((value, row) => {
    if (!Number.isInteger(value) || value < lower || value > upper) {
      throw new RangeError(
        `${name}[${row}]: expected integer code in [${lower}, ${upper}], got ${value}`,
      );
    }
  });
  return name === "ssCode"
    ? Uint8Array.from(values)
    : name === "formalCharge"
    ? Int8Array.from(values)
    : Int32Array.from(values);
}
