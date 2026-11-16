// Sensor disagreement: which fire-cell-days MODIS saw, VIIRS saw, or both saw.
//
// Every cell-day carries the set of platforms that detected it, so the three
// categories are exact and mutually exclusive, and they add up to the union:
//   MODIS-only = any − VIIRS,  VIIRS-only = any − MODIS,  both = MODIS + VIIRS − any.
// Disagreement is not an error of either sensor: VIIRS has 375 m pixels and
// detects smaller and cooler fires, Terra observes ~3 h earlier than the
// afternoon satellites, and an outage removes one sensor's observations.
// Statistics use only months both sensors observed completely (no satellite
// operating part of the month or with a material outage).
import type { MonthResult, PVals } from "./series";
import { COV_PLATFORMS } from "./coverage";

export type Split = { modisOnly: number; viirsOnly: number; both: number; union: number };
export const split = (v: Pick<PVals, "M" | "V" | "ALL">): Split => ({ modisOnly: v.ALL - v.V, viirsOnly: v.ALL - v.M, both: v.M + v.V - v.ALL, union: v.ALL });
const add = (a: Split, b: Split): Split => ({ modisOnly: a.modisOnly + b.modisOnly, viirsOnly: a.viirsOnly + b.viirsOnly, both: a.both + b.both, union: a.union + b.union });
export const ZERO_SPLIT: Split = { modisOnly: 0, viirsOnly: 0, both: 0, union: 0 };

/** Shares of the union (the denominator is every cell-day detected by at least one sensor). */
export const shares = (s: Split) => (s.union > 0 ? { modisOnly: s.modisOnly / s.union, viirsOnly: s.viirsOnly / s.union, both: s.both / s.union } : null);
/** Share of one sensor's cell-days that the other sensor also detected. */
export const confirmedBy = (s: Split) => ({ modisSeenByViirs: s.modisOnly + s.both > 0 ? s.both / (s.modisOnly + s.both) : null, viirsSeenByModis: s.viirsOnly + s.both > 0 ? s.both / (s.viirsOnly + s.both) : null });

/** Why a month is left out of disagreement statistics (null = both sensors observed it completely). */
export function overlapIssue(r: MonthResult): string | null {
  const c = r.coverage;
  const modisOn = c.operating.Terra === "full" && c.operating.Aqua === "full";
  const viirsOn = (["S-NPP", "NOAA-20", "NOAA-21"] as const).some((p) => c.operating[p] === "full");
  if (!viirsOn) return "no VIIRS satellite observed the whole month";
  if (!modisOn) return "Terra or Aqua did not observe the whole month";
  const part = COV_PLATFORMS.filter((p) => c.operating[p] === "partial");
  if (part.length) return `${part.join(", ")} started or stopped during the month`;
  const lost = COV_PLATFORMS.filter((p) => c.operating[p] !== "none" && c.material[p]);
  if (lost.length) return `outage: ${lost.map((p) => `${p} lost ${(100 * c.loss[p]).toFixed(0)}%`).join(", ")}`;
  return null;
}

export type MonthSplit = { month: string; any: Split; day: Split; night: Split; issue: string | null };
export const monthSplit = (r: MonthResult): MonthSplit => ({ month: r.month, any: split(r.raw.any), day: split(r.raw.day), night: split(r.raw.night), issue: overlapIssue(r) });

export type AtlasSummary = {
  months: MonthSplit[]; // every month in range with VIIRS in orbit
  used: number; // months entering the statistics
  excluded: Array<{ month: string; issue: string }>;
  total: Split; day: Split; night: Split;
  byMoy: Array<{ moy: number; any: Split; day: Split; night: Split; months: number }>;
  byYear: Array<{ year: number; any: Split; months: number }>;
};

/** Disagreement statistics over [from, to], months both sensors observed completely. */
export function atlasSummary(results: MonthResult[], from: string, to: string): AtlasSummary {
  const viirsInOrbit = (r: MonthResult) => (["S-NPP", "NOAA-20", "NOAA-21"] as const).some((p) => r.coverage.operating[p] !== "none");
  const months = results.filter((r) => r.month >= from && r.month <= to && viirsInOrbit(r)).map(monthSplit);
  const ok = months.filter((m) => !m.issue);
  const byMoy = Array.from({ length: 12 }, (_, i) => ({ moy: i + 1, any: ZERO_SPLIT, day: ZERO_SPLIT, night: ZERO_SPLIT, months: 0 }));
  const years = new Map<number, { year: number; any: Split; months: number }>();
  let total = ZERO_SPLIT, day = ZERO_SPLIT, night = ZERO_SPLIT;
  for (const m of ok) {
    total = add(total, m.any); day = add(day, m.day); night = add(night, m.night);
    const b = byMoy[+m.month.slice(5, 7) - 1];
    b.any = add(b.any, m.any); b.day = add(b.day, m.day); b.night = add(b.night, m.night); b.months++;
    const y = +m.month.slice(0, 4);
    const e = years.get(y) ?? { year: y, any: ZERO_SPLIT, months: 0 };
    e.any = add(e.any, m.any); e.months++;
    years.set(y, e);
  }
  return { months, used: ok.length, excluded: months.filter((m) => m.issue).map((m) => ({ month: m.month, issue: m.issue! })), total, day, night, byMoy, byYear: [...years.values()].sort((a, b) => a.year - b.year) };
}

/** Map cells: overview rows [cell index, period index, anySensor, MODIS, VIIRS] (periods are years) summed over [fromYear, toYear]. */
export function cellSplits(rows: number[][], periods: string[], fromYear: number, toYear: number): Map<number, Split> {
  const out = new Map<number, Split>();
  for (const w of rows) {
    const y = +periods[w[1]];
    if (y < fromYear || y > toYear) continue;
    const s = split({ ALL: w[2], M: w[3], V: w[4] });
    out.set(w[0], add(out.get(w[0]) ?? ZERO_SPLIT, s));
  }
  return out;
}
