// Statistics for the calendar: history comparisons, rankings and trend.

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
};
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
/** Percent of history strictly below x, counting ties as half (mid-rank percentile). */
export function percentileRank(history: number[], x: number) {
  if (!history.length) return NaN;
  let below = 0, equal = 0;
  for (const h of history) { if (h < x) below++; else if (h === x) equal++; }
  return (100 * (below + equal / 2)) / history.length;
}

export type HistoryComparison = {
  value: number;
  n: number;
  median: number;
  pctOfMedian: number | null; // 100 = equal to median; null when the median is 0
  mean: number; // multi-year average of the history
  pctOfMean: number | null; // 100 = equal to the multi-year average; null when the average is 0
  diffFromMean: number; // value - multi-year average
  percentile: number;
  z: number | null; // null when the history has no spread
  rank: number; // 1 = highest including the current value
  of: number;
  min: number;
  max: number;
};

/** Compare a value with the same period in other years. */
export function compareToHistory(value: number, history: number[]): HistoryComparison | null {
  if (!history.length) return null;
  const med = median(history), s = sd(history), avg = mean(history);
  return {
    value,
    n: history.length,
    median: med,
    pctOfMedian: med > 0 ? (100 * value) / med : null,
    mean: avg,
    pctOfMean: avg > 0 ? (100 * value) / avg : null,
    diffFromMean: value - avg,
    percentile: percentileRank(history, value),
    z: Number.isFinite(s) && s > 0 ? (value - mean(history)) / s : null,
    rank: 1 + history.filter((h) => h > value).length,
    of: history.length + 1,
    min: Math.min(...history),
    max: Math.max(...history),
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export type Trend = { n: number; slope: number; intercept: number; slopeLo: number; slopeHi: number; s: number; z: number; p: number; pctPerDecade: number | null };

/**
 * Theil–Sen slope with a Mann–Kendall test (tie-corrected variance, continuity
 * correction) and the slope's 95 % confidence interval from the MK variance.
 */
export function theilSen(points: { x: number; y: number }[]): Trend | null {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 4) return null;
  const slopes: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    if (dx !== 0) slopes.push(dy / dx);
    s += Math.sign(dy) * Math.sign(dx);
  }
  slopes.sort((a, b) => a - b);
  const slope = median(slopes);
  const intercept = median(pts.map((p) => p.y - slope * p.x));
  const ties = new Map<number, number>();
  for (const p of pts) ties.set(p.y, (ties.get(p.y) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = varS > 0 ? (s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0) : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  const c = 1.959964 * Math.sqrt(varS), N = slopes.length;
  const lo = Math.round((N - c) / 2), hi = Math.round((N + c) / 2) + 1;
  const at = (k: number) => slopes[Math.min(N - 1, Math.max(0, k - 1))];
  const midX = median(pts.map((q) => q.x)), level = intercept + slope * midX;
  return { n, slope, intercept, slopeLo: at(lo), slopeHi: at(hi), s, z, p, pctPerDecade: level > 0 ? (1000 * slope) / level : null };
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
