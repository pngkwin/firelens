// Calendar features on top of harmonized month/day results.
import type { DayResult, MonthResult } from "./series";
import { compareToHistory, theilSen, median, type HistoryComparison, type Trend } from "./stats";

export type Scale = "modis-eq" | "viirs-level" | "raw-all" | "raw-modis" | "raw-viirs" | "hotspots-modis" | "hotspots-viirs";
/**
 * unit: what one count means. Fire-cell-days (~1 km cells) are the harmonized
 * unit; "hotspots" are FIRMS detections (MODIS 1 km pixels, VIIRS 375 m
 * pixels), after the region clip and static-source mask. Detection counts of
 * different sensors are never added together (they would double count fires).
 */
export const SCALES: Record<Scale, { label: string; short: string; harmonized: boolean; unit: string }> = {
  "modis-eq": { label: "MODIS-equivalent hotspots (harmonized, ~1 km fire-cell-days)", short: "MODIS-eq.", harmonized: true, unit: "fire-cell-days" },
  "viirs-level": { label: "VIIRS-level (harmonized, S-NPP scale, ~1 km fire-cell-days)", short: "VIIRS-level", harmonized: true, unit: "fire-cell-days" },
  "raw-all": { label: "Raw fire-cell-days: any sensor", short: "Raw any", harmonized: false, unit: "fire-cell-days" },
  "raw-modis": { label: "Raw fire-cell-days: MODIS (Terra ∪ Aqua)", short: "Raw MODIS", harmonized: false, unit: "fire-cell-days" },
  "raw-viirs": { label: "Raw fire-cell-days: VIIRS (any platform)", short: "Raw VIIRS", harmonized: false, unit: "fire-cell-days" },
  "hotspots-modis": { label: "Raw hotspots detected: MODIS (1 km pixels, Terra + Aqua)", short: "MODIS", harmonized: false, unit: "hotspots" },
  "hotspots-viirs": { label: "Raw hotspots detected: VIIRS (375 m pixels, all platforms)", short: "VIIRS", harmonized: false, unit: "hotspots" },
};
export const isScale = (s: unknown): s is Scale => typeof s === "string" && s in SCALES;

export function monthValue(r: MonthResult, scale: Scale): number | null {
  switch (scale) {
    case "modis-eq": return r.value;
    case "viirs-level": return r.viirsLevel;
    case "raw-all": return r.raw.any.ALL;
    case "raw-modis": return r.raw.any.M;
    case "raw-viirs": return r.raw.any.V;
    case "hotspots-modis": return r.det[0] + r.det[1];
    case "hotspots-viirs": return r.det[2] + r.det[3] + r.det[4];
  }
}
/** Interval on the chosen scale; null when the value is observed (no model). */
export function monthInterval(r: MonthResult, scale: Scale): [number, number] | null {
  if (scale === "modis-eq") return r.cls === "modis-observed" || r.value == null || r.lo == null || r.hi == null ? null : [r.lo, r.hi];
  if (scale === "viirs-level") {
    // Before VIIRS: MODIS-eq x month-of-year ratio. Only the MODIS-eq part has a
    // quantified interval (Terra-only era); the ratio's own uncertainty is not modelled.
    if (!r.viirsLevelEstimated || r.viirsLevel == null || !r.value || r.lo == null || r.hi == null || r.lo === r.hi) return null;
    return [(r.viirsLevel * r.lo) / r.value, (r.viirsLevel * r.hi) / r.value];
  }
  return null;
}
export function isEstimated(r: MonthResult, scale: Scale) {
  return scale === "modis-eq" ? r.cls !== "modis-observed" : scale === "viirs-level" ? r.viirsLevelEstimated : false;
}
export const isPartial = (r: MonthResult) => r.daysCovered < r.daysInMonth;
export function dayValue(d: DayResult, scale: Scale): number | null {
  switch (scale) {
    case "modis-eq": return d.value;
    case "viirs-level": return d.viirsLevel;
    case "raw-all": return d.raw.ALL;
    case "raw-modis": return d.raw.M;
    case "raw-viirs": return d.raw.V;
    case "hotspots-modis": return d.raw.det[0] + d.raw.det[1];
    case "hotspots-viirs": return d.raw.det[2] + d.raw.det[3] + d.raw.det[4];
  }
}

export const inRange = (month: string, from: string, to: string) => month >= from && month <= to;

export type Ranked = { key: string; value: number; lo: number | null; hi: number | null; estimated: boolean; partial: boolean };

export function rankMonths(results: MonthResult[], scale: Scale, n = 10): Ranked[] {
  return results
    .map((r) => ({ r, v: monthValue(r, scale) }))
    .filter((x): x is { r: MonthResult; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v || (a.r.month < b.r.month ? -1 : 1))
    .slice(0, n)
    .map(({ r, v }) => { const iv = monthInterval(r, scale); return { key: r.month, value: v, lo: iv?.[0] ?? null, hi: iv?.[1] ?? null, estimated: isEstimated(r, scale), partial: isPartial(r) }; });
}

export type Annual = { year: number; value: number; lo: number; hi: number; months: number; estimatedMonths: number; partial: boolean };
/**
 * Annual totals. Interval bounds are summed (assumes fully correlated monthly
 * errors, i.e. conservative). A year is partial when any month is missing or
 * not fully covered.
 */
export function annualTotals(results: MonthResult[], scale: Scale): Annual[] {
  const by = new Map<number, Annual>();
  for (const r of results) {
    const v = monthValue(r, scale);
    if (v == null) continue;
    const y = +r.month.slice(0, 4);
    const a = by.get(y) ?? { year: y, value: 0, lo: 0, hi: 0, months: 0, estimatedMonths: 0, partial: false };
    const iv = monthInterval(r, scale);
    a.value += v; a.lo += iv?.[0] ?? v; a.hi += iv?.[1] ?? v; a.months++;
    if (isEstimated(r, scale)) a.estimatedMonths++;
    if (isPartial(r)) a.partial = true;
    by.set(y, a);
  }
  for (const a of by.values()) if (a.months < 12) a.partial = true;
  return [...by.values()].sort((a, b) => a.year - b.year);
}

export type FocusComparison = {
  month: string;
  mode: "full-month" | "month-to-date";
  throughDay: number; // days 1..throughDay compared
  value: number;
  interval: [number, number] | null;
  estimated: boolean;
  history: { year: number; value: number }[];
  stats: HistoryComparison | null;
  boundsAgree: "above" | "below" | "mixed" | null; // where the interval sits relative to the median
};

/**
 * Focus month vs the same month in other years. A partial month is compared
 * month-to-date (days 1..D in every year) and needs daily results; a complete
 * month is compared on monthly totals. Only years whose month is fully covered
 * enter the history.
 */
export function compareFocus(results: MonthResult[], days: DayResult[] | null, focus: string, scale: Scale): FocusComparison | null {
  const cur = results.find((r) => r.month === focus);
  if (!cur) return null;
  const moy = focus.slice(5, 7);
  const others = results.filter((r) => r.month.slice(5, 7) === moy && r.month !== focus && !isPartial(r) && monthValue(r, scale) != null);
  let value: number | null, history: { year: number; value: number }[], interval: [number, number] | null = monthInterval(cur, scale);
  const D = cur.daysCovered;
  if (!isPartial(cur)) {
    value = monthValue(cur, scale);
    history = others.map((r) => ({ year: +r.month.slice(0, 4), value: monthValue(r, scale)! }));
  } else {
    if (!days) return null;
    const sum = (month: string) => {
      let s = 0;
      for (const d of days) if (d.day.startsWith(month) && +d.day.slice(8) <= D) s += dayValue(d, scale) ?? 0;
      return s;
    };
    value = monthValue(cur, scale); // the partial month's own total is month-to-date
    history = others.map((r) => ({ year: +r.month.slice(0, 4), value: sum(r.month) }));
  }
  if (value == null) return null;
  const stats = compareToHistory(value, history.map((h) => h.value));
  const med = stats?.median ?? null;
  const boundsAgree = med == null ? null : interval ? (interval[0] > med ? "above" : interval[1] < med ? "below" : "mixed") : value > med ? "above" : value < med ? "below" : "mixed";
  return { month: focus, mode: isPartial(cur) ? "month-to-date" : "full-month", throughDay: D, value, interval, estimated: isEstimated(cur, scale), history, stats, boundsAgree };
}

/** Theil–Sen trend over complete years in [fromYear, toYear]. */
export function annualTrend(annual: Annual[], fromYear: number, toYear: number): Trend | null {
  return theilSen(annual.filter((a) => !a.partial && a.year >= fromYear && a.year <= toYear).map((a) => ({ x: a.year, y: a.value })));
}

/** Median and maximum per month of year over complete months in range. */
export function climatology(results: MonthResult[], scale: Scale) {
  return Array.from({ length: 12 }, (_, i) => {
    const vals = results.filter((r) => +r.month.slice(5, 7) === i + 1 && !isPartial(r)).map((r) => monthValue(r, scale)).filter((v): v is number => v != null);
    return { moy: i + 1, median: vals.length ? median(vals) : null, max: vals.length ? Math.max(...vals) : null, n: vals.length };
  });
}

/**
 * Every month compared with the same month in all *other* complete years on
 * the chosen scale (median, multi-year average, z-score, percentile). Null
 * when no other year has that month.
 */
export function monthAnomalies(results: MonthResult[], scale: Scale): Map<string, (HistoryComparison & { n: number }) | null> {
  const byMoy = new Map<string, MonthResult[]>();
  for (const r of results) if (!isPartial(r) && monthValue(r, scale) != null) {
    const k = r.month.slice(5, 7);
    if (!byMoy.has(k)) byMoy.set(k, []);
    byMoy.get(k)!.push(r);
  }
  const out = new Map<string, (HistoryComparison & { n: number }) | null>();
  for (const r of results) {
    const v = monthValue(r, scale);
    const hist = (byMoy.get(r.month.slice(5, 7)) ?? []).filter((h) => h.month !== r.month).map((h) => monthValue(h, scale)!);
    out.set(r.month, v == null ? null : compareToHistory(v, hist));
  }
  return out;
}
