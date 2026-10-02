/** Literal values exercising exponent notation, signs and the binary32 limits. */
export const NUMERIC_CASES = [
  0,
  -0,
  1e21,
  -1e21,
  1e-7,
  -1e-7,
  2 ** -126,
  2 ** -149,
  (2 - 2 ** -23) * 2 ** 127,
  -(2 - 2 ** -23) * 2 ** 127,
  1e-50,
  -1e-50,
];
