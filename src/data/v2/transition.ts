// Sensor-transition investigator: what a month looks like under three readings.
//  - naive splice: raw MODIS until 2011, raw VIIRS from 2012 (the series a user
//    gets by switching to the newer sensor). NOT COMPARABLE across 2012: VIIRS
//    detects about twice as many fire-cell-days, so later years look extreme.
//  - MODIS alone: raw Terra ∪ Aqua all the way (comparable sensor, but orbit
//    drift from 2022 and outages lower recent values).
//  - harmonized: the MODIS-equivalent series with intervals and coverage rules.
import type { MonthResult } from "./series";
import { annualTotals, annualTrend, compareFocus, isPartial, monthStatus } from "./analysis";
import { compareToHistory, theilSen, type HistoryComparison, type Trend } from "./stats";

export const SPLICE_YEAR = 2012; // first year S-NPP VIIRS observed (from 2012-01-20)
export const naiveValue = (r: MonthResult) => (+r.month.slice(0, 4) < SPLICE_YEAR ? r.raw.any.M : r.raw.any.V);

export type TransitionRow = { year: number; month: string; harmonized: number | null; lo: number | null; hi: number | null; rawModis: number; rawViirs: number | null; naive: number; estimated: boolean; reduced: boolean; partial: boolean };

/** One row per year for the focus month of year. */
export function transitionSeries(results: MonthResult[], moy: string): TransitionRow[] {
  return results.filter((r) => r.month.slice(5, 7) === moy).map((r) => ({
    year: +r.month.slice(0, 4), month: r.month,
    harmonized: r.value, lo: r.cls === "modis-observed" ? null : r.lo, hi: r.cls === "modis-observed" ? null : r.hi,
    rawModis: r.raw.any.M, rawViirs: monthStatus(r, "raw-viirs").available ? r.raw.any.V : null, naive: naiveValue(r),
    estimated: r.cls !== "modis-observed", reduced: r.reduced, partial: isPartial(r),
  }));
}

export type Reading = { label: string; comparable: boolean; value: number | null; stats: HistoryComparison | null; note: string };
const verdict = (s: HistoryComparison | null) => (!s ? "no comparison" : s.percentile >= 90 ? "unusually high" : s.percentile <= 10 ? "unusually low" : s.pctOfMedian != null && s.pctOfMedian >= 100 ? "above the median" : "below the median");
export const readingVerdict = (r: Reading) => verdict(r.stats);

/** The focus month (complete months only) under the naive splice, MODIS alone and the harmonized series. */
export function readings(results: MonthResult[], focus: string): Reading[] | null {
  const cur = results.find((r) => r.month === focus);
  if (!cur || isPartial(cur)) return null;
  const moy = focus.slice(5, 7);
  const others = results.filter((r) => r.month.slice(5, 7) === moy && r.month !== focus && !isPartial(r));
  const naive = compareToHistory(naiveValue(cur), others.map(naiveValue));
  const modis = compareFocus(results, null, focus, "raw-modis");
  const harm = compareFocus(results, null, focus, "modis-eq");
  return [
    { label: "Naive splice (raw MODIS to 2011, raw VIIRS from 2012)", comparable: false, value: naiveValue(cur), stats: naive, note: "Not comparable: years before and after 2012 come from different sensors with different sensitivity." },
    { label: "MODIS alone (raw Terra ∪ Aqua)", comparable: true, value: cur.raw.any.M, stats: modis?.stats ?? null, note: modis?.blocked ?? (+focus.slice(0, 4) >= 2022 ? "Same sensor, but Terra and Aqua orbits drift from 2022, lowering recent MODIS counts." : "Same sensor throughout; outage months are left out of the baseline.") },
    { label: "Harmonized MODIS-equivalent (FireLens)", comparable: true, value: cur.value, stats: harm?.stats ?? null, note: harm?.blocked ?? (cur.cls === "modis-observed" ? "Observed MODIS in a stable-orbit year." : `Estimated (${cur.cls === "terra-only-estimated" ? "Terra-only scaling" : `from ${cur.viirsPlatform ?? "VIIRS"}`}) with a 90% interval.`) },
  ];
}

export type TrendReading = { naive: Trend | null; harmonized: Trend | null; years: [number, number] };
/** Annual trend over complete years under the naive splice and the harmonized series. */
export function trendReadings(results: MonthResult[], fromYear: number, toYear: number): TrendReading {
  const byYear = new Map<number, { v: number; n: number }>();
  for (const r of results) {
    const y = +r.month.slice(0, 4);
    if (y < fromYear || y > toYear || isPartial(r)) continue;
    const e = byYear.get(y) ?? { v: 0, n: 0 };
    e.v += naiveValue(r); e.n++;
    byYear.set(y, e);
  }
  const naive = theilSen([...byYear].filter(([, e]) => e.n === 12).map(([x, e]) => ({ x, y: e.v })));
  const harmonized = annualTrend(annualTotals(results.filter((r) => +r.month.slice(0, 4) >= fromYear && +r.month.slice(0, 4) <= toYear), "modis-eq"), fromYear, toYear, "modis-eq").trend;
  return { naive, harmonized, years: [fromYear, toYear] };
}
