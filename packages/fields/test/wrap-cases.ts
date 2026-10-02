/** Explicit values for closed-domain linear overflow, including reversed domains. */
export const WRAP_CASES = [
  { domain: [0, 1], values: [-2, -1, -0.5, 0], expected: [10, 10, 15, 10] },
  {
    domain: [0, 1],
    values: [0.25, 0.75, 1, 1.5],
    expected: [12.5, 17.5, 20, 15],
  },
  {
    domain: [0, 1],
    values: [2, 3, -0.125, 1.125],
    expected: [10, 10, 18.75, 11.25],
  },
  { domain: [-2, 2], values: [-10, -6, -4, -2], expected: [10, 10, 15, 10] },
  { domain: [-2, 2], values: [-1, 1, 2, 4], expected: [12.5, 17.5, 20, 15] },
  {
    domain: [-2, 2],
    values: [6, 10, -2.5, 2.5],
    expected: [10, 10, 18.75, 11.25],
  },
  { domain: [2, -2], values: [10, 6, 4, 2], expected: [10, 10, 15, 10] },
  { domain: [2, -2], values: [1, -1, -2, -4], expected: [12.5, 17.5, 20, 15] },
  {
    domain: [2, -2],
    values: [-6, -10, 2.5, -2.5],
    expected: [10, 10, 18.75, 11.25],
  },
] as const;
