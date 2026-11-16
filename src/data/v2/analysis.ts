// Calendar features on top of harmonized month/day results.
import type { DayResult, MonthResult } from "./series";
import { compareToHistory, theilSen, median, type HistoryComparison, type Trend } from "./stats";
import { COV_PLATFORMS, dayFlag, type Coverage, type CovPlatform } from "./coverage";

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

/** Satellites behind each raw scale (harmonized scales: see monthStatus). */
export const SCALE_PLATFORMS: Partial<Record<Scale, readonly CovPlatform[]>> = {
  "raw-all": COV_PLATFORMS,
  "raw-modis": ["Terra", "Aqua"],
  "raw-viirs": ["S-NPP", "NOAA-20", "NOAA-21"],
  "hotspots-modis": ["Terra", "Aqua"],
  "hotspots-viirs": ["S-NPP", "NOAA-20", "NOAA-21"],
};
/** Fewer other years than this with the same satellites and full coverage: no anomaly is computed. */
export const MIN_HISTORY = 3;
/** A year whose flagged months may miss more than this share of its total is left out of trends. */
export const TREND_MAX_LOSS = 0.02;

export type MonthStatus = {
  /** False before any satellite of a raw scale was in orbit (no observation, not a zero). */
  available: boolean;
  /** Raw scales: the satellites observing all month ("Terra+Aqua"); "transition" when one started or stopped mid-month. Harmonized: "harmonized". */
  config: string;
  /** Material observation loss (flagged satellite outage) or a satellite operating only part of the month. */
  reduced: boolean;
  /** Upper bound of the share of the month's value missing because of flagged outages (0 when none). */
  missingShare: number;
  reasons: string[];
};

const pct = (x: number) => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%`;
const lossNote = (r: MonthResult, p: CovPlatform) =>
  `${p} not observing on ${r.coverage.flaggedDays[p]} day${r.coverage.flaggedDays[p] === 1 ? "" : "s"} (${pct(r.coverage.loss[p])} of its expected detections lost)`;
/** Missing share implied by a loss L of the detections behind a value: L / (1 - L), capped. */
const missingFrom = (l: number) => Math.min(19, l / Math.max(0.05, 1 - l));

/** Observation status of a month on a scale: availability, satellite configuration and coverage. */
export function monthStatus(r: MonthResult, scale: Scale): MonthStatus {
  const plats = SCALE_PLATFORMS[scale];
  const c = r.coverage;
  if (!plats) {
    // Harmonized scales rest on one source per month.
    const viirsObserved = scale === "viirs-level" && !r.viirsLevelEstimated;
    const basis: CovPlatform[] = viirsObserved || r.cls === "viirs-estimated"
      ? (r.viirsPlatform ? [r.viirsPlatform as CovPlatform] : [])
      : r.cls === "terra-only-estimated" ? ["Terra"] : ["Terra", "Aqua"];
    const reduced = scale === "viirs-level" ? r.viirsReduced : r.reduced;
    const value = scale === "viirs-level" ? r.viirsLevel : r.value;
    const reasons = basis.filter((p) => c.material[p]).map((p) => lossNote(r, p));
    if (r.cls === "modis-observed" && c.operating.Aqua === "partial") reasons.push("Aqua observed only part of the month (first data 2002-07-04)");
    if (r.cls === "viirs-estimated" && !r.viirsPlatform) reasons.push("no VIIRS satellite observed the whole month");
    const missingShare = reduced ? Math.min(19, basis.reduce((s, p) => s + missingFrom(c.loss[p]), 0)) : 0;
    return { available: value != null, config: "harmonized", reduced, missingShare, reasons };
  }
  const on = plats.filter((p) => c.operating[p] !== "none");
  if (!on.length) return { available: false, config: "none", reduced: false, missingShare: 0, reasons: [`no ${plats.join(" / ")} satellite was observing yet`] };
  const part = on.filter((p) => c.operating[p] === "partial");
  const lost = on.filter((p) => c.material[p]);
  const reasons = [...part.map((p) => `${p} observed only part of the month (started or stopped producing data)`), ...lost.map((p) => lossNote(r, p))];
  return {
    available: true,
    config: part.length ? "transition" : on.join("+"),
    reduced: part.length > 0 || lost.length > 0,
    missingShare: Math.min(19, lost.reduce((s, p) => s + missingFrom(c.loss[p]), 0)),
    reasons,
  };
}
/** Usable as a baseline year: observed by the scale's satellites all month, without material outage. */
export const isComparable = (r: MonthResult, scale: Scale) => { const st = monthStatus(r, scale); return st.available && !st.reduced; };
/** Raw scales: the satellite configuration of the latest comparable month (statistics across configurations would measure added satellites). */
export function latestConfig(results: MonthResult[], scale: Scale): string | null {
  if (!SCALE_PLATFORMS[scale]) return null;
  for (let i = results.length - 1; i >= 0; i--) if (!isPartial(results[i]) && isComparable(results[i], scale)) return monthStatus(results[i], scale).config;
  return null;
}
const sameConfig = (r: MonthResult, scale: Scale, config: string | null) => config == null || monthStatus(r, scale).config === config;

export function monthValue(r: MonthResult, scale: Scale): number | null {
  if (SCALE_PLATFORMS[scale] && !monthStatus(r, scale).available) return null; // before the sensor existed: no value, never a zero
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

/** Observation status of one day on a scale. */
export type DayObs = { observed: boolean; reduced: boolean; config: string; reasons: string[] };
/**
 * Whether the satellites behind a scale were observing on a day. Raw scales:
 * the scale's satellites in orbit that day; harmonized: the month's source
 * (Terra ∪ Aqua when observed, Terra before Aqua, the month's VIIRS reference
 * after 2021). `observed` is false before any such satellite existed or when
 * all of them have a flagged gap; `reduced` when any of them is flagged.
 */
export function dayStatus(day: string, scale: Scale, cov: Coverage | undefined, month?: MonthResult): DayObs {
  const plats = SCALE_PLATFORMS[scale];
  let basis: CovPlatform[];
  if (plats) basis = plats.filter((p) => { const w = cov?.operating[p]; return !!w && w[0] <= day && w[1] >= day; });
  else {
    const cls = month?.cls ?? (day.slice(0, 7) < "2002-07" ? "terra-only-estimated" : "modis-observed");
    const viirsBasis = (scale === "viirs-level" && month && !month.viirsLevelEstimated) || cls === "viirs-estimated";
    basis = viirsBasis ? (month?.viirsPlatform ? [month.viirsPlatform as CovPlatform] : []) : cls === "terra-only-estimated" ? ["Terra"] : ["Terra", "Aqua"];
  }
  if (!basis.length) return { observed: false, reduced: false, config: "none", reasons: [plats ? `no ${plats.join(" / ")} satellite in orbit` : "no reference satellite"] };
  const flagged = basis.filter((p) => dayFlag(cov, p, day) != null);
  const reasons = flagged.map((p) => {
    const ev = cov?.events.find((e) => e.platform === p && e.start <= day && e.end >= day);
    return `${p} ${dayFlag(cov, p, day) === "gap" ? "not observing" : "partly observing"}${ev ? ` (${ev.status} outage${ev.status === "confirmed" ? ", NASA/NOAA notice" : ", from the records"})` : ""}`;
  });
  const dark = basis.filter((p) => dayFlag(cov, p, day) === "gap");
  return { observed: dark.length < basis.length, reduced: flagged.length > 0, config: plats ? basis.join("+") : "harmonized", reasons };
}
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

export type Ranked = { key: string; value: number; lo: number | null; hi: number | null; estimated: boolean; partial: boolean; reduced: boolean };

/** Top months. Raw scales: only months with the latest satellite configuration. */
export function rankMonths(results: MonthResult[], scale: Scale, n = 10): Ranked[] {
  const config = latestConfig(results, scale);
  return results
    .filter((r) => sameConfig(r, scale, config))
    .map((r) => ({ r, v: monthValue(r, scale) }))
    .filter((x): x is { r: MonthResult; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v || (a.r.month < b.r.month ? -1 : 1))
    .slice(0, n)
    .map(({ r, v }) => { const iv = monthInterval(r, scale); return { key: r.month, value: v, lo: iv?.[0] ?? null, hi: iv?.[1] ?? null, estimated: isEstimated(r, scale), partial: isPartial(r), reduced: monthStatus(r, scale).reduced }; });
}

export type Annual = {
  year: number; value: number; lo: number; hi: number; months: number; estimatedMonths: number; partial: boolean;
  /** Months with reduced satellite coverage, and an upper bound of the share of the year's total they may miss. */
  reducedMonths: number; missingShare: number;
  /** Raw scales: one satellite configuration for all its months, else "mixed"; harmonized: "harmonized". */
  config: string;
};
/**
 * Annual totals. Interval bounds are summed (assumes fully correlated monthly
 * errors, i.e. conservative). A year is partial when any month is missing or
 * not fully covered.
 */
export function annualTotals(results: MonthResult[], scale: Scale): Annual[] {
  const by = new Map<number, Annual & { missing: number; configs: Set<string> }>();
  for (const r of results) {
    const v = monthValue(r, scale);
    if (v == null) continue;
    const y = +r.month.slice(0, 4);
    const a = by.get(y) ?? { year: y, value: 0, lo: 0, hi: 0, months: 0, estimatedMonths: 0, partial: false, reducedMonths: 0, missingShare: 0, config: "", missing: 0, configs: new Set<string>() };
    const iv = monthInterval(r, scale), st = monthStatus(r, scale);
    a.value += v; a.lo += iv?.[0] ?? v; a.hi += iv?.[1] ?? v; a.months++;
    if (isEstimated(r, scale)) a.estimatedMonths++;
    if (isPartial(r)) a.partial = true;
    if (st.reduced) { a.reducedMonths++; a.missing += v * st.missingShare; }
    a.configs.add(st.config);
    by.set(y, a);
  }
  return [...by.values()].sort((a, b) => a.year - b.year).map(({ missing, configs, ...a }) => ({
    ...a,
    partial: a.partial || a.months < 12,
    missingShare: a.value > 0 ? missing / a.value : missing > 0 ? 1 : 0,
    config: configs.size === 1 ? [...configs][0] : "mixed",
  }));
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
  /** Why no comparison is shown (reduced coverage, no comparable years); null when the statistics are valid. */
  blocked: string | null;
  status: MonthStatus;
};

/** The month's comparable baseline on this scale, and why it cannot be compared (null = it can). */
function baseline(results: MonthResult[], cur: MonthResult, scale: Scale) {
  const status = monthStatus(cur, scale);
  const moy = cur.month.slice(5, 7);
  const others = results.filter((r) => r.month.slice(5, 7) === moy && r.month !== cur.month && !isPartial(r) && isComparable(r, scale) && monthStatus(r, scale).config === status.config);
  let blocked: string | null = null;
  if (!status.available) blocked = `Not observed: ${status.reasons.join("; ")}. Months before a sensor was in orbit have no value, not zero.`;
  else if (status.config === "transition") blocked = `Not compared: the satellites changed during this month (${status.reasons.join("; ")}).`;
  else if (status.reduced) blocked = `Not compared: reduced satellite coverage (${status.reasons.join("; ")}). The value is incomplete and is excluded from anomaly claims.`;
  else if (others.length < MIN_HISTORY)
    blocked = SCALE_PLATFORMS[scale]
      ? `Not compared: only ${others.length} other year${others.length === 1 ? "" : "s"} observed this month with the same satellites (${status.config.replaceAll("+", ", ")}) and full coverage; at least ${MIN_HISTORY} are needed. Raw counts from different sets of satellites are not comparable; use the harmonized scale.`
      : `Not compared: only ${others.length} other year${others.length === 1 ? "" : "s"} with full coverage for this month; at least ${MIN_HISTORY} are needed.`;
  return { status, others, blocked };
}

/**
 * Focus month vs the same month in other years. A partial month is compared
 * month-to-date (days 1..D in every year) and needs daily results; a complete
 * month is compared on monthly totals. Only years whose month is fully
 * covered, observed without material satellite outage and (raw scales) by the
 * same satellites enter the history. With fewer than MIN_HISTORY such years,
 * or when the month itself has reduced coverage, no statistics are computed
 * and `blocked` says why.
 */
export function compareFocus(results: MonthResult[], days: DayResult[] | null, focus: string, scale: Scale): FocusComparison | null {
  const cur = results.find((r) => r.month === focus);
  if (!cur) return null;
  const { status, others, blocked } = baseline(results, cur, scale);
  if (!status.available) return { month: focus, mode: isPartial(cur) ? "month-to-date" : "full-month", throughDay: cur.daysCovered, value: NaN, interval: null, estimated: false, history: [], stats: null, boundsAgree: null, blocked, status };
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
  const stats = blocked ? null : compareToHistory(value, history.map((h) => h.value));
  const med = stats?.median ?? null;
  const boundsAgree = med == null ? null : interval ? (interval[0] > med ? "above" : interval[1] < med ? "below" : "mixed") : value > med ? "above" : value < med ? "below" : "mixed";
  return { month: focus, mode: isPartial(cur) ? "month-to-date" : "full-month", throughDay: D, value, interval, estimated: isEstimated(cur, scale), history, stats, boundsAgree, blocked, status };
}

export type TrendResult = {
  trend: Trend | null;
  years: number[]; // years used
  excluded: Array<{ year: number; reason: string }>;
  config: string | null; // raw scales: the satellites the trend is restricted to
  note: string | null; // why there is no trend, or what it is restricted to
};
/**
 * Theil–Sen trend over complete years in [fromYear, toYear]. Years whose
 * flagged satellite outages may miss more than TREND_MAX_LOSS of the total are
 * left out. On raw scales only years observed all year by the same satellites
 * as the latest such year are used: a trend across satellite configurations
 * would measure satellites being added, not fire.
 */
export function annualTrend(annual: Annual[], fromYear: number, toYear: number, scale: Scale = "modis-eq"): TrendResult {
  const raw = !!SCALE_PLATFORMS[scale];
  const excluded: TrendResult["excluded"] = [];
  const pool = annual.filter((a) => !a.partial && a.year >= fromYear && a.year <= toYear).filter((a) => {
    if (a.missingShare > TREND_MAX_LOSS) { excluded.push({ year: a.year, reason: `satellite outage: up to ${(100 * a.missingShare).toFixed(1)}% of the year may be missing` }); return false; }
    return true;
  });
  let config: string | null = null, use = pool;
  if (raw) {
    config = [...pool].reverse().find((a) => a.config !== "mixed" && a.config !== "transition")?.config ?? null;
    use = pool.filter((a) => {
      if (a.config === config) return true;
      excluded.push({ year: a.year, reason: a.config === "mixed" || a.config === "transition" ? "satellites changed during the year" : `different satellites (${a.config.replaceAll("+", ", ")})` });
      return false;
    });
  }
  excluded.sort((a, b) => a.year - b.year);
  const trend = theilSen(use.map((a) => ({ x: a.year, y: a.value })));
  const sats = config?.replaceAll("+", ", ");
  const note = raw
    ? config == null
      ? "No trend: no complete year in the range was observed all year by one set of satellites."
      : trend
        ? `Restricted to years observed all year by ${sats}: raw counts rise when satellites are added, so years with other satellites are left out.`
        : `No trend: only ${use.length} complete year${use.length === 1 ? "" : "s"} observed by the same satellites (${sats}); a trend needs 4. Raw counts from different sets of satellites are not comparable; use the harmonized scale for long-term trends.`
    : trend ? null : "Not enough complete years in the selected range for a trend (needs 4).";
  return { trend, years: use.map((a) => a.year), excluded, config, note };
}

/** Median and maximum per month of year over complete, fully covered months in range (raw scales: latest satellite configuration only). */
export function climatology(results: MonthResult[], scale: Scale) {
  const config = latestConfig(results, scale);
  return Array.from({ length: 12 }, (_, i) => {
    const vals = results.filter((r) => +r.month.slice(5, 7) === i + 1 && !isPartial(r) && isComparable(r, scale) && sameConfig(r, scale, config)).map((r) => monthValue(r, scale)).filter((v): v is number => v != null);
    return { moy: i + 1, median: vals.length ? median(vals) : null, max: vals.length ? Math.max(...vals) : null, n: vals.length };
  });
}

/**
 * Every month compared with the same month in all *other* complete, fully
 * covered years (raw scales: same satellites) on the chosen scale (median,
 * multi-year average, z-score, percentile). Null when the month has reduced
 * coverage or fewer than MIN_HISTORY comparable years exist (same rules as
 * compareFocus).
 */
export function monthAnomalies(results: MonthResult[], scale: Scale): Map<string, (HistoryComparison & { n: number }) | null> {
  const out = new Map<string, (HistoryComparison & { n: number }) | null>();
  for (const r of results) {
    const v = monthValue(r, scale);
    const { others, blocked } = baseline(results, r, scale);
    out.set(r.month, v == null || blocked ? null : compareToHistory(v, others.map((h) => monthValue(h, scale)!)));
  }
  return out;
}
