/** One finite binary32 literal; CPU-authored values retain their JS precision. */
export function f32Literal(x: number): string {
  const rounded = Math.fround(x);
  if (!Number.isFinite(x) || !Number.isFinite(rounded)) {
    throw new TypeError(
      "@molgpu/fields compile: literal must round to a finite f32",
    );
  }
  if (Object.is(rounded, -0)) return "-0.0";
  const text = String(rounded);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** A denominator must remain nonzero, with distinct endpoints in binary32. */
export function f32Span(lo: number, hi: number): string {
  const span = hi - lo;
  const literal = f32Literal(span);
  if (Math.fround(span) === 0 || Math.fround(lo) === Math.fround(hi)) {
    throw new TypeError(
      "@molgpu/fields compile: interpolation span collapses in f32",
    );
  }
  return literal;
}
