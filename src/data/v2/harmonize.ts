// MODIS-equivalent harmonization of fire-cell-day series (method v2).
// Pure functions shared by the Node fitting/validation scripts and the
// browser. See docs/harmonization-method.md for the scientific rationale.

export const METHOD_VERSION = "fcd-harmonize-v2";

export type Overpass = "day" | "night";
export type RatioFit = { k: number | null; m: number; v: number; n: number };

/**
 * Ratio-of-sums estimator k = Σm / Σv, optionally shrunk toward a parent ratio
 * with a pseudo-count kappa (in VIIRS cell-days): k = (Σm + κ·k₀)/(Σv + κ).
 * Ratio of sums is robust to months with zero detections.
 */
export function fitRatio(
  pts: { m: number; v: number }[],
  opts: { parent?: number | null; kappa?: number } = {},
): RatioFit {
  const m = pts.reduce((s, p) => s + p.m, 0);
  const v = pts.reduce((s, p) => s + p.v, 0);
  const kappa = opts.kappa ?? 0;
  const parent = opts.parent ?? null;
  let k: number | null;
  if (parent != null && kappa > 0) k = (m + kappa * parent) / (v + kappa);
  else k = v > 0 ? m / v : null;
  return { k, m, v, n: pts.length };
}

export type StratumRow = { zone: string; year: number; moy: number; o: Overpass; m: number; v: number };

/**
 * Hierarchical fit: region x overpass  ->  region x month-of-year x overpass
 * -> zone x month-of-year x overpass, each level shrunk toward its parent.
 * Keys: "*|*|o", "*|moy|o", "zone|moy|o".
 */
export function fitStratified(rows: StratumRow[], { kappa = 20 } = {}) {
  const out = new Map<string, RatioFit>();
  const group = (key: (r: StratumRow) => string) => {
    const g = new Map<string, StratumRow[]>();
    for (const r of rows) {
      const k = key(r);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    }
    return g;
  };
  for (const [k, rs] of group((r) => `*|*|${r.o}`)) out.set(k, fitRatio(rs));
  for (const [k, rs] of group((r) => `*|${r.moy}|${r.o}`))
    out.set(k, fitRatio(rs, { parent: out.get(`*|*|${rs[0].o}`)!.k, kappa }));
  for (const [k, rs] of group((r) => `${r.zone}|${r.moy}|${r.o}`))
    out.set(k, fitRatio(rs, { parent: out.get(`*|${rs[0].moy}|${rs[0].o}`)!.k, kappa }));
  return out;
}

/** Look up the most specific available coefficient. */
export function coefficient(table: Map<string, RatioFit>, zone: string, moy: number, o: Overpass): number | null {
  return table.get(`${zone}|${moy}|${o}`)?.k ?? table.get(`*|${moy}|${o}`)?.k ?? table.get(`*|*|${o}`)?.k ?? null;
}

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Multiplicative prediction interval from leave-one-year-out residual ratios
 * r = m / (k₋ᵧ · v). Coverage is itself estimated by a second leave-one-out
 * level, so the reported coverage is out-of-sample.
 */
export function looIntervals(rows: { year: number; m: number; v: number }[], level = 0.9) {
  const years = [...new Set(rows.map((r) => r.year))];
  const resid: { year: number; r: number }[] = [];
  for (const y of years) {
    const k = fitRatio(rows.filter((r) => r.year !== y)).k;
    if (!k) continue;
    for (const r of rows.filter((x) => x.year === y && x.v > 0)) resid.push({ year: y, r: r.m / (k * r.v) });
  }
  const a = (1 - level) / 2;
  const all = resid.map((x) => x.r).sort((p, q) => p - q);
  let hits = 0, tested = 0;
  for (const x of resid) {
    const others = resid.filter((z) => z.year !== x.year).map((z) => z.r).sort((p, q) => p - q);
    if (others.length < 4) continue;
    tested++;
    if (x.r >= quantile(others, a) && x.r <= quantile(others, 1 - a)) hits++;
  }
  return { lo: quantile(all, a), hi: quantile(all, 1 - a), coverage: tested ? hits / tested : NaN, n: resid.length };
}

export type QuantileMap = { v: number[]; m: number[] };
export function quantileMapFit(v: number[], m: number[]): QuantileMap {
  return { v: [...v].sort((a, b) => a - b), m: [...m].sort((a, b) => a - b) };
}
/** Empirical CDF matching with ratio extrapolation outside the training range. */
export function quantileMapApply(qm: QuantileMap, x: number): number {
  const { v, m } = qm;
  if (!v.length) return NaN;
  const vmin = v[0], vmax = v[v.length - 1];
  if (x <= vmin) return vmin > 0 ? (x * m[0]) / vmin : m[0];
  if (x >= vmax) return vmax > 0 ? (x * m[m.length - 1]) / vmax : m[m.length - 1];
  let i = 0;
  while (v[i + 1] < x) i++;
  const frac = v[i + 1] === v[i] ? 0 : (x - v[i]) / (v[i + 1] - v[i]);
  const p = (i + frac) / (v.length - 1);
  return quantile(m, p);
}

type ViirsPlatform = "S-NPP" | "NOAA-20" | "NOAA-21";
const monthBounds = (month: string) => {
  const [y, mo] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return [`${month}-01`, last] as const;
};

/**
 * Single continuous VIIRS reference series on the S-NPP scale. A platform is
 * used only for months it covers completely; NOAA-20/21 are scaled by their
 * cross-calibration factors to S-NPP. Using one platform at a time avoids
 * artificial jumps when the number of VIIRS platforms changes.
 */
export function referenceViirs(
  month: string,
  values: Record<ViirsPlatform, number>,
  cover: Partial<Record<ViirsPlatform, readonly [string, string]>>,
  cross: Partial<Record<ViirsPlatform, number>>,
  dataEnd?: string, // last loaded day: a current, partial month counts as covered up to here
): { value: number | null; platform: ViirsPlatform | null } {
  const [first, monthLast] = monthBounds(month);
  const last = dataEnd && dataEnd < monthLast ? dataEnd : monthLast;
  for (const p of ["S-NPP", "NOAA-20", "NOAA-21"] as const) {
    const c = cover[p];
    if (!c || c[0] > first || c[1] < last) continue;
    const scale = p === "S-NPP" ? 1 : cross[p];
    if (scale == null) continue;
    return { value: values[p] * scale, platform: p };
  }
  return { value: null, platform: null };
}

export type PeriodClass = "terra-only-estimated" | "modis-observed" | "viirs-estimated";
export const PERIODS = { aquaStart: "2002-07", driftStart: "2022-01" };
/**
 * Which harmonized source a month uses:
 * - before Aqua (2002-07): Terra-only MODIS scaled to Terra∪Aqua (estimated);
 * - Aqua era through 2021: observed MODIS (stable orbits);
 * - from 2022: MODIS orbits drift (Terra lowered Oct 2022, earlier crossing;
 *   Aqua left the A-Train 2022), so MODIS-equivalent is estimated from VIIRS.
 */
export function periodClass(month: string, p = PERIODS): PeriodClass {
  if (month < p.aquaStart) return "terra-only-estimated";
  if (month < p.driftStart) return "modis-observed";
  return "viirs-estimated";
}

/** Any-time cell-days from day and night estimates; rho = Σany/Σ(day+night) in training. */
export const combineOverpass = (day: number, night: number, rho: number) => (day + night) * rho;

export function metrics(obs: number[], pred: number[]) {
  const n = obs.length;
  if (!n || n !== pred.length) throw Error("metrics needs equal, non-empty arrays");
  let ae = 0, se = 0, bias = 0;
  for (let i = 0; i < n; i++) {
    const d = pred[i] - obs[i];
    ae += Math.abs(d); se += d * d; bias += d;
  }
  const mo = obs.reduce((a, b) => a + b, 0) / n, mp = pred.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (obs[i] - mo) * (pred[i] - mp); sxx += (obs[i] - mo) ** 2; syy += (pred[i] - mp) ** 2;
  }
  return { n, mae: ae / n, rmse: Math.sqrt(se / n), bias: bias / n, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN, totalObs: mo * n, totalPred: mp * n };
}

// ---- v2 ------------------------------------------------------------------------

export type MethodId = "stratified" | "qm";
/**
 * Pre-registered selection rule (v2): quantile mapping is used for a region
 * only if its leave-one-year-out monthly MAE is strictly lower than the
 * stratified ratio's; otherwise the stratified ratio is kept.
 */
export function selectMethod(mae: { stratified: number; qm: number }): MethodId {
  return Number.isFinite(mae.qm) && mae.qm < mae.stratified ? "qm" : "stratified";
}

/**
 * Multiplicative interval from held-out residual ratios r = obs / pred, where
 * every pred is already out-of-sample (leave-one-year-out). Coverage is
 * estimated by recomputing the quantiles without each year in turn.
 */
export function residualIntervals(rows: { year: number; obs: number; pred: number }[], level = 0.9) {
  const resid = rows.filter((r) => r.pred > 0).map((r) => ({ year: r.year, r: r.obs / r.pred }));
  const a = (1 - level) / 2;
  const all = resid.map((x) => x.r).sort((p, q) => p - q);
  let hits = 0, tested = 0;
  for (const x of resid) {
    const others = resid.filter((z) => z.year !== x.year).map((z) => z.r).sort((p, q) => p - q);
    if (others.length < 4) continue;
    tested++;
    if (x.r >= quantile(others, a) && x.r <= quantile(others, 1 - a)) hits++;
  }
  return { lo: quantile(all, a), hi: quantile(all, 1 - a), coverage: tested ? hits / tested : NaN, n: resid.length };
}

/**
 * Quantile mapping of a (possibly partial) month: the VIIRS reference x is
 * mapped at its full-month run rate (x · f, f = days in month / days observed)
 * and scaled back, because the mapping was fitted on whole-month totals.
 */
export function qmEstimate(qm: QuantileMap, x: number, f = 1): number {
  return quantileMapApply(qm, x * f) / f;
}
