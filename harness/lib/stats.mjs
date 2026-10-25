// Small statistics for timing results.

export function quantile(values, q) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = (a.length - 1) * q;
  const lo = Math.floor(i);
  return lo === i ? a[lo] : a[lo] + (a[lo + 1] - a[lo]) * (i - lo);
}
export const median = (values) => quantile(values, 0.5);

export function summary(values) {
  const a = values.filter(Number.isFinite);
  if (!a.length) return { n: 0 };
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  return { n: a.length, min: Math.min(...a), p50: median(a), p90: quantile(a, 0.9), p95: quantile(a, 0.95), max: Math.max(...a), mean };
}

/** Median absolute deviation: a spread that a few outliers on a busy machine don't inflate. */
export function mad(values) {
  const m = median(values);
  return median(values.map((x) => Math.abs(x - m)));
}

/**
 * Compares two samples of the same measurement (lower is better unless higherIsBetter, e.g. scores).
 * `change` is the relative change of the median; `noise` is the larger relative MAD of the two, so
 * |change| well above `noise` is real. Verdict: same, better or worse.
 */
export function compare(base, cand, { higherIsBetter = false } = {}) {
  const b = median(base);
  const c = median(cand);
  if (!Number.isFinite(b) || !Number.isFinite(c) || b === 0) {
    return { base: b, cand: c, change: NaN, noise: NaN, verdict: 'unavailable' };
  }
  const noise = Math.max(mad(base) / b, mad(cand) / c);
  const change = (c - b) / b;
  const improved = higherIsBetter ? change > 0 : change < 0;
  return { base: b, cand: c, change, noise, verdict: Math.abs(change) <= Math.max(noise * 2, 0.03) ? 'same' : improved ? 'better' : 'worse' };
}

export const round = (x, digits = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** digits) / 10 ** digits : x);
