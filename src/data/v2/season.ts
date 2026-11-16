// Fire-season evolution: how the distribution of detected burning across the
// months of the year changes between multi-year periods, for any area.
//
// Each year is normalized to shares of its own annual total, so a big year does
// not dominate the profile; a period profile is the equal-weight mean of its
// years' shares. Years enter only if all 12 months are present, the year is
// complete, and flagged satellite outages may miss at most TREND_MAX_LOSS of the
// annual total (the same rule as trends).
//
// Period comparisons use year-level permutation tests (years exchangeable
// between periods), exact when the number of splits is small, with a Holm
// correction across the three statistics. They are descriptive tests of the
// detection record for the selected area: no interval at state or smaller
// scale is validated, and the tests do not model autocorrelation between years.
import type { MonthResult } from "./series";
import { annualTotals, isPartial, monthStatus, monthValue, TREND_MAX_LOSS, type Scale } from "./analysis";

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export type SeasonPeriod = { id: string; label: string; from: number; to: number; note: string };
/**
 * Default periods. The first two are both observed MODIS (Terra ∪ Aqua) on the
 * harmonized scale, so their comparison does not depend on the calibration; the
 * third is VIIRS-based MODIS-equivalent estimates and is shown descriptively.
 */
export const DEFAULT_PERIODS: SeasonPeriod[] = [
  { id: "p1", label: "2003–2012", from: 2003, to: 2012, note: "observed MODIS" },
  { id: "p2", label: "2013–2021", from: 2013, to: 2021, note: "observed MODIS" },
  { id: "p3", label: "2022–2025", from: 2022, to: 2025, note: "estimated from VIIRS (descriptive only)" },
];

export type SeasonYear = { year: number; total: number; shares: number[]; centroid: number; r: number; peak3: { start: number; share: number }; m80: number; estimatedMonths: number };

const TAU = 2 * Math.PI;
const angle = (i: number) => (TAU * (i + 0.5)) / 12; // month index 0..11 at its centre
/** Circular centroid (month position, 0.5 = start of Jan … 12.5 = end of Dec) and concentration R (0 = spread evenly, 1 = one month). */
export function circular(shares: number[]) {
  let x = 0, y = 0;
  shares.forEach((s, i) => { x += s * Math.cos(angle(i)); y += s * Math.sin(angle(i)); });
  const tot = shares.reduce((a, b) => a + b, 0) || 1;
  const a = (Math.atan2(y, x) + TAU) % TAU;
  return { centroid: (a / TAU) * 12, r: Math.hypot(x, y) / tot };
}
/** Best run of 3 consecutive months (wrapping over the new year). */
export function peak3(shares: number[]) {
  let best = { start: 0, share: -1 };
  for (let i = 0; i < 12; i++) { const s = shares[i] + shares[(i + 1) % 12] + shares[(i + 2) % 12]; if (s > best.share) best = { start: i, share: s }; }
  return best;
}
/** Fewest months (any, not necessarily consecutive) that hold at least 80% of the year's activity. */
export function months80(shares: number[]) {
  const s = [...shares].sort((a, b) => b - a);
  let acc = 0;
  for (let i = 0; i < 12; i++) { acc += s[i]; if (acc >= 0.8 - 1e-12) return i + 1; }
  return 12;
}

/** Normalized seasonal shape of every usable year. */
export function seasonYears(months: MonthResult[], scale: Scale = "modis-eq"): { years: SeasonYear[]; excluded: Array<{ year: number; reason: string }> } {
  const annual = new Map(annualTotals(months, scale).map((a) => [a.year, a]));
  const byYear = new Map<number, MonthResult[]>();
  for (const r of months) { const y = +r.month.slice(0, 4); byYear.set(y, [...(byYear.get(y) ?? []), r]); }
  const years: SeasonYear[] = [], excluded: Array<{ year: number; reason: string }> = [];
  for (const [y, rs] of [...byYear].sort((a, b) => a[0] - b[0])) {
    const a = annual.get(y);
    const vals = Array.from({ length: 12 }, (_, i) => { const r = rs.find((m) => +m.month.slice(5, 7) === i + 1); return r && !isPartial(r) ? monthValue(r, scale) : null; });
    if (vals.some((v) => v == null) || !a || a.partial) { excluded.push({ year: y, reason: "incomplete year" }); continue; }
    if (a.missingShare > TREND_MAX_LOSS) { excluded.push({ year: y, reason: `satellite outage: up to ${(100 * a.missingShare).toFixed(1)}% of the year may be missing` }); continue; }
    const total = (vals as number[]).reduce((s, v) => s + v, 0);
    if (!(total > 0)) { excluded.push({ year: y, reason: "no detections" }); continue; }
    const shares = (vals as number[]).map((v) => v / total);
    const c = circular(shares);
    years.push({ year: y, total, shares, centroid: c.centroid, r: c.r, peak3: peak3(shares), m80: months80(shares), estimatedMonths: rs.filter((m) => scale === "modis-eq" && m.cls !== "modis-observed").length });
  }
  return { years, excluded };
}

export type PeriodProfile = {
  period: SeasonPeriod; n: number; years: number[]; shares: number[]; peakMonth: number; peakShare: number;
  peak3: { start: number; share: number }; centroid: number; r: number; m80: number; meanTotal: number; estimatedYears: number;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export function periodProfile(years: SeasonYear[], p: SeasonPeriod): PeriodProfile | null {
  const ys = years.filter((y) => y.year >= p.from && y.year <= p.to);
  if (!ys.length) return null;
  const shares = Array.from({ length: 12 }, (_, i) => mean(ys.map((y) => y.shares[i])));
  const peakMonth = shares.indexOf(Math.max(...shares));
  const c = circular(shares);
  return { period: p, n: ys.length, years: ys.map((y) => y.year), shares, peakMonth, peakShare: shares[peakMonth], peak3: peak3(shares), centroid: c.centroid, r: c.r, m80: months80(shares), meanTotal: mean(ys.map((y) => y.total)), estimatedYears: ys.filter((y) => y.estimatedMonths > 0).length };
}

// ---- year-level permutation tests --------------------------------------------------
type Stat = { id: "centroid" | "concentration" | "months80"; label: string; unit: string };
export const SEASON_STATS: Stat[] = [
  { id: "centroid", label: "Seasonal centre (mean of yearly circular centres)", unit: "months" },
  { id: "concentration", label: "Concentration R, mean of years (0 = even, 1 = one month)", unit: "" },
  { id: "months80", label: "Months holding 80% of activity, mean of years", unit: "months" },
];
/** Signed circular difference b − a in months, in (−6, 6]. */
export const circDiff = (a: number, b: number) => { let d = b - a; while (d > 6) d -= 12; while (d <= -6) d += 12; return d; };
function groupStat(id: Stat["id"], ys: SeasonYear[]): number {
  if (id === "concentration") return mean(ys.map((y) => y.r));
  if (id === "months80") return mean(ys.map((y) => y.m80));
  let x = 0, y = 0; // mean direction of the years' centroids (equal weight)
  for (const v of ys) { x += Math.cos((v.centroid / 12) * TAU); y += Math.sin((v.centroid / 12) * TAU); }
  return (((Math.atan2(y, x) + TAU) % TAU) / TAU) * 12;
}
const diffOf = (id: Stat["id"], a: SeasonYear[], b: SeasonYear[]) => id === "centroid" ? circDiff(groupStat(id, a), groupStat(id, b)) : groupStat(id, b) - groupStat(id, a);

function* combinations(n: number, k: number): Generator<number[]> {
  const c = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield c;
    let i = k - 1;
    while (i >= 0 && c[i] === n - k + i) i--;
    if (i < 0) return;
    c[i]++;
    for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  }
}
const choose = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

export type SeasonTest = { stat: Stat; a: number; b: number; diff: number; p: number; pHolm: number; exact: boolean; permutations: number };
/** Two-sided permutation tests of period B against period A; Holm-adjusted across the three statistics. */
export function compareSeasons(a: SeasonYear[], b: SeasonYear[], maxExact = 200_000, draws = 20_000): SeasonTest[] | null {
  if (a.length < 4 || b.length < 4) return null;
  const all = [...a, ...b], n = all.length, k = a.length;
  const total = choose(n, k), exact = total <= maxExact;
  const obs = SEASON_STATS.map((s) => Math.abs(diffOf(s.id, a, b)));
  const hits = SEASON_STATS.map(() => 0);
  let perms = 0;
  const evalSplit = (idx: number[]) => {
    const inA = new Set(idx);
    const A = idx.map((i) => all[i]), B = all.filter((_, i) => !inA.has(i));
    SEASON_STATS.forEach((s, j) => { if (Math.abs(diffOf(s.id, A, B)) >= obs[j] - 1e-12) hits[j]++; });
    perms++;
  };
  if (exact) for (const c of combinations(n, k)) evalSplit(c);
  else {
    const r = rng(20261115);
    evalSplit(Array.from({ length: k }, (_, i) => i)); // the observed split counts once
    for (let d = 0; d < draws; d++) {
      const idx = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      evalSplit(idx.slice(0, k));
    }
  }
  const p = hits.map((h) => h / perms);
  // Holm step-down
  const order = p.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const pHolm = Array(p.length).fill(0);
  let run = 0;
  order.forEach(([v, i], r) => { run = Math.max(run, Math.min(1, v * (p.length - r))); pHolm[i] = run; });
  return SEASON_STATS.map((s, j) => ({ stat: s, a: groupStat(s.id, a), b: groupStat(s.id, b), diff: diffOf(s.id, a, b), p: p[j], pHolm: pHolm[j], exact, permutations: perms }));
}

// ---- does the measurement system change the seasonal picture? ----------------------
export type SensorSeason = { years: number[]; modis: number[]; snpp: number[]; modisCentroid: number; snppCentroid: number; shift: number; maxMonthDiff: { month: number; diff: number } };
/**
 * Seasonal shares of raw MODIS (Terra ∪ Aqua) and raw S-NPP VIIRS fire-cell-days
 * over the same years, using only years in which both were observed in every
 * month without material outage. Differences show how much the seasonal picture
 * depends on the sensor (VIIRS detects more small and cool fires).
 */
export function sensorSeason(months: MonthResult[], from = 2013, to = 2021): SensorSeason | null {
  const years: number[] = [], M: number[][] = [], V: number[][] = [];
  for (let y = from; y <= to; y++) {
    const rs = months.filter((r) => +r.month.slice(0, 4) === y);
    if (rs.length !== 12 || rs.some(isPartial)) continue;
    const ok = rs.every((r) => { const st = monthStatus(r, "raw-modis"); return st.available && !st.reduced && r.coverage.operating["S-NPP"] === "full" && !r.coverage.material["S-NPP"]; });
    if (!ok) continue;
    const m = rs.map((r) => r.raw.any.M), v = rs.map((r) => r.raw.any["S-NPP"]);
    const sm = m.reduce((a, b) => a + b, 0), sv = v.reduce((a, b) => a + b, 0);
    if (!(sm > 0 && sv > 0)) continue;
    years.push(y); M.push(m.map((x) => x / sm)); V.push(v.map((x) => x / sv));
  }
  if (years.length < 3) return null;
  const modis = Array.from({ length: 12 }, (_, i) => mean(M.map((s) => s[i]))), snpp = Array.from({ length: 12 }, (_, i) => mean(V.map((s) => s[i])));
  const cm = circular(modis).centroid, cv = circular(snpp).centroid;
  const diffs = snpp.map((v, i) => v - modis[i]);
  const iMax = diffs.map(Math.abs).indexOf(Math.max(...diffs.map(Math.abs)));
  return { years, modis, snpp, modisCentroid: cm, snppCentroid: cv, shift: circDiff(cm, cv), maxMonthDiff: { month: iMax, diff: diffs[iMax] } };
}

/** "early Mar", "mid-Aug", "late Oct" for a circular month position (0.5 = start of Jan). */
export function monthPosition(c: number) {
  const x = ((c % 12) + 12) % 12; // 0..12, 0 = 1 Jan
  const i = Math.floor(x), f = x - i;
  return `${f < 1 / 3 ? "early" : f < 2 / 3 ? "mid" : "late"} ${MONTH_NAMES[i]}`;
}

export type SeasonAnalysis = { profiles: PeriodProfile[]; tests: SeasonTest[] | null; excluded: Array<{ year: number; reason: string }>; sensor: SensorSeason | null; findings: string[] };
export function analyzeSeason(months: MonthResult[], periods = DEFAULT_PERIODS): SeasonAnalysis {
  const { years, excluded } = seasonYears(months, "modis-eq");
  const profiles = periods.map((p) => periodProfile(years, p)).filter((p): p is PeriodProfile => !!p);
  const [p1, p2] = periods;
  const A = years.filter((y) => y.year >= p1.from && y.year <= p1.to), B = years.filter((y) => y.year >= p2.from && y.year <= p2.to);
  const tests = compareSeasons(A, B);
  const sensor = sensorSeason(months);
  const findings: string[] = [];
  const a = profiles.find((p) => p.period.id === p1.id), b = profiles.find((p) => p.period.id === p2.id);
  if (a && b) {
    findings.push(`Peak month ${MONTH_NAMES[a.peakMonth]} (${(100 * a.peakShare).toFixed(0)}% of a typical year) in ${p1.label} and ${MONTH_NAMES[b.peakMonth]} (${(100 * b.peakShare).toFixed(0)}%) in ${p2.label}; the busiest three months are ${MONTH_NAMES[a.peak3.start]}–${MONTH_NAMES[(a.peak3.start + 2) % 12]} (${(100 * a.peak3.share).toFixed(0)}%) and ${MONTH_NAMES[b.peak3.start]}–${MONTH_NAMES[(b.peak3.start + 2) % 12]} (${(100 * b.peak3.share).toFixed(0)}%).`);
    if (tests) {
      const sig = tests.filter((t) => t.pHolm < 0.05);
      findings.push(sig.length
        ? `Changes that survive the permutation test with Holm correction: ${sig.map((t) => `${t.stat.label.toLowerCase()} ${t.diff >= 0 ? "+" : ""}${t.diff.toFixed(2)}${t.stat.unit ? ` ${t.stat.unit}` : ""} (adjusted p = ${t.pHolm.toFixed(3)})`).join("; ")}.`
        : `No change in the seasonal centre, concentration or spread between ${p1.label} and ${p2.label} survives the permutation test with Holm correction (smallest adjusted p = ${Math.min(...tests.map((t) => t.pHolm)).toFixed(2)}, ${A.length} vs ${B.length} years). The record does not show a shifted or lengthened season here; small samples limit what can be detected.`);
    } else findings.push(`Too few usable years (${A.length} and ${B.length}; at least 4 each) to test a change between ${p1.label} and ${p2.label}.`);
  }
  if (sensor) findings.push(`Measurement check ${sensor.years[0]}–${sensor.years.at(-1)} (${sensor.years.length} years): raw S-NPP VIIRS puts the seasonal centre ${Math.abs(sensor.shift) < 0.05 ? "at the same point as" : `${Math.abs(sensor.shift).toFixed(2)} months ${sensor.shift >= 0 ? "later than" : "earlier than"}`} raw MODIS over the same years; the largest single-month difference is ${MONTH_NAMES[sensor.maxMonthDiff.month]} (${sensor.maxMonthDiff.diff >= 0 ? "+" : ""}${(100 * sensor.maxMonthDiff.diff).toFixed(1)} percentage points in VIIRS).`);
  return { profiles, tests, excluded, sensor, findings };
}
