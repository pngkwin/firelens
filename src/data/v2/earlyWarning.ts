// Early-warning indicators from daily values: recent windows against the same
// window in earlier years, climatological critical periods, and a historical
// outlook for the coming weeks. Days without rows inside the covered period
// are zeros ("no matching records").
import type { DayResult } from "./series";
import { dayValue, type Scale } from "./analysis";
import { compareToHistory, median, type HistoryComparison } from "./stats";

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Same month-day in another year (Feb 29 -> Feb 28). */
export function sameDayIn(year: number, day: string): string {
  return `${year}-${day.slice(5) === "02-29" ? "02-28" : day.slice(5)}`;
}

/** Sum of a scale over [start, end] inclusive; days without rows are zeros. */
function windowSum(byDay: Map<string, DayResult>, start: string, end: string, scale: Scale) {
  let s = 0;
  for (let t = toMs(start); t <= toMs(end); t += DAY_MS) {
    const d = byDay.get(toDay(t));
    if (d) s += dayValue(d, scale) ?? 0;
  }
  return s;
}

export type WindowComparison = { days: number; start: string; end: string; value: number; history: { year: number; value: number }[]; stats: HistoryComparison | null };

/**
 * The `len` days ending at `end`, compared with the same calendar window in
 * every earlier year whose window lies fully inside the covered period.
 */
export function recentWindow(days: DayResult[], end: string, len: number, scale: Scale, coverStart: string): WindowComparison {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const start = toDay(toMs(end) - (len - 1) * DAY_MS);
  const value = windowSum(byDay, start, end, scale);
  const history: { year: number; value: number }[] = [];
  for (let y = +coverStart.slice(0, 4); y <= +end.slice(0, 4); y++) {
    const e = sameDayIn(y, end), s = toDay(toMs(e) - (len - 1) * DAY_MS);
    if (e >= end || s < coverStart) continue;
    history.push({ year: y, value: windowSum(byDay, s, e, scale) });
  }
  return { days: len, start, end, value, history, stats: compareToHistory(value, history.map((h) => h.value)) };
}

/**
 * Daily climatology on a 365-day circle: for each day of year, the median over
 * complete years of a centred `smooth`-day moving average. Complete years lie
 * fully inside [coverStart, coverEnd]. Feb 29 is dropped.
 */
export function dailyClimatology(days: DayResult[], scale: Scale, coverStart: string, coverEnd: string, smooth = 15) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const years: number[] = [];
  for (let y = +coverStart.slice(0, 4); y <= +coverEnd.slice(0, 4); y++) if (`${y}-01-01` >= coverStart && `${y}-12-31` <= coverEnd) years.push(y);
  const series = years.map((y) => {
    const out: number[] = [];
    for (let t = toMs(`${y}-01-01`); t <= toMs(`${y}-12-31`); t += DAY_MS) {
      const day = toDay(t);
      if (day.slice(5) === "02-29") continue;
      const d = byDay.get(day);
      out.push(d ? dayValue(d, scale) ?? 0 : 0);
    }
    return out;
  });
  const h = Math.floor(smooth / 2);
  const med = Array.from({ length: 365 }, (_, i) => (series.length ? median(series.map((s) => { let t = 0; for (let k = -h; k <= h; k++) t += s[(i + k + 365) % 365]; return t / (2 * h + 1); })) : 0));
  return { years: years.length, median: med };
}

export type Period = { start: number; end: number; peak: number }; // day-of-year 0..364 (non-leap); may wrap (start > end)

/** Contiguous (circular) runs where the climatology is at least `frac` × its peak, largest peak first. */
export function criticalPeriods(clim: number[], frac = 0.5): Period[] {
  const peakV = Math.max(...clim);
  if (!(peakV > 0)) return [];
  const on = clim.map((v) => v >= frac * peakV);
  if (on.every(Boolean)) return [{ start: 0, end: 364, peak: clim.indexOf(peakV) }];
  const quiet = on.indexOf(false); // walk the circle starting after a quiet day
  const runs: number[][] = [];
  let cur: number[] | null = null;
  for (let k = 1; k <= 365; k++) {
    const i = (quiet + k) % 365;
    if (on[i]) (cur ??= []).push(i);
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs
    .map((ix) => ({ start: ix[0], end: ix[ix.length - 1], peak: ix.reduce((p, i) => (clim[i] > clim[p] ? i : p), ix[0]) }))
    .sort((a, b) => clim[b.peak] - clim[a.peak]);
}
/** "Jul 1" for a non-leap day-of-year index. */
export const doyLabel = (i: number) => new Date(Date.UTC(2001, 0, 1 + i)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** Non-leap day-of-year index of a date (Feb 29 maps to Feb 28). */
export const doyIndex = (day: string) => Math.round((toMs(`2001-${day.slice(5) === "02-29" ? "02-28" : day.slice(5)}`) - toMs("2001-01-01")) / DAY_MS);
export const inPeriod = (p: Period, i: number) => (p.start <= p.end ? i >= p.start && i <= p.end : i >= p.start || i <= p.end);

export type Outlook = { start: string; end: string; years: number; median: number; p90: number; max: { year: number; value: number } | null };

/** The `len` days after `from`, as observed in every earlier year whose window is fully covered. */
export function historicalOutlook(days: DayResult[], from: string, len: number, scale: Scale, coverStart: string, coverEnd: string): Outlook {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const start = toDay(toMs(from) + DAY_MS), end = toDay(toMs(from) + len * DAY_MS);
  const vals: { year: number; value: number }[] = [];
  for (let y = +coverStart.slice(0, 4); y <= +end.slice(0, 4); y++) {
    const s = sameDayIn(y, start), e = toDay(toMs(s) + (len - 1) * DAY_MS);
    if (s < coverStart || e > coverEnd || s >= start) continue;
    vals.push({ year: y, value: windowSum(byDay, s, e, scale) });
  }
  const sorted = vals.map((v) => v.value).sort((a, b) => a - b);
  const p90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.round(0.9 * (sorted.length - 1)))] : NaN;
  const max = vals.reduce<{ year: number; value: number } | null>((m, v) => (!m || v.value > m.value ? v : m), null);
  return { start, end, years: vals.length, median: sorted.length ? median(sorted) : NaN, p90, max };
}
