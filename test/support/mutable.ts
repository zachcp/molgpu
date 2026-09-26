// Test-only: the public types are read-only by contract, but tests build bad
// inputs by mutating good fixtures. Mutable<T> strips `readonly` all the way
// down; typed arrays are left as they are (their elements are always writable).
export type Mutable<T> =
  T extends ArrayBufferView ? T
    : T extends readonly (infer U)[] ? Mutable<U>[]
      : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> }
        : T;
