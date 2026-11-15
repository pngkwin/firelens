// AOI time series and MODIS-equivalent harmonization in the browser.
//
// Raw values are exact unions from the mask histograms. Harmonized values
// apply the published calibration exactly as scripts/harmonize/fit.mjs does
// (series.test.ts checks the whole-region result against the fit's own
// regionSeries for every month). Daily harmonized values distribute each
// month's estimate over its days in proportion to the month's reference
// sensor, so days always sum to the monthly value.
import { cellToLatLng, cellToParent } from "h3-js";
import { union, BIT, MODIS, VIIRS, ALL, PLATFORMS, type V2Partition, type FlatHist } from "./codec";
import { referenceViirs, periodClass, combineOverpass, qmEstimate, type PeriodClass } from "./harmonize";
import type { Calibration, Interval } from "./bundle";

export type PKey = "M" | "Terra" | "Aqua" | "S-NPP" | "NOAA-20" | "NOAA-21" | "V" | "ALL";
export type PVals = Record<PKey, number>;
const ZERO = (): PVals => ({ M: 0, Terra: 0, Aqua: 0, "S-NPP": 0, "NOAA-20": 0, "NOAA-21": 0, V: 0, ALL: 0 });
export function pvals(h: FlatHist): PVals {
  return { M: union(h, MODIS), Terra: union(h, BIT.Terra), Aqua: union(h, BIT.Aqua), "S-NPP": union(h, BIT["S-NPP"]), "NOAA-20": union(h, BIT["NOAA-20"]), "NOAA-21": union(h, BIT["NOAA-21"]), V: union(h, VIIRS), ALL: union(h, ALL) };
}
const addTo = (a: PVals, b: PVals) => { for (const k in b) a[k as PKey] += b[k as PKey]; };

export type ZoneVals = { day: PVals; night: PVals; any: PVals; det: number[]; frp: number[] };
const zoneZero = (): ZoneVals => ({ day: ZERO(), night: ZERO(), any: ZERO(), det: [0, 0, 0, 0, 0], frp: [0, 0, 0, 0, 0] });
/** month -> zone (res-1) -> values */
export type MonthZones = Map<string, Map<string, ZoneVals>>;
/** day -> any-time values */
/** Any-time cell-day unions plus FIRMS detections per platform (PLATFORMS order). */
export type DayAgg = PVals & { det: number[] };
export type DayVals = Map<string, DayAgg>;

const centres = new Map<string, [number, number]>();
/** Cached res-5 cell centre as [lon, lat]. */
export function cellCentre(cell: string): [number, number] {
  let c = centres.get(cell);
  if (!c) {
    const [lat, lon] = cellToLatLng(cell);
    centres.set(cell, (c = [lon, lat]));
  }
  return c;
}

const masks = new WeakMap<V2Partition, { keep: unknown; inside: boolean[] }>();
function insideMask(part: V2Partition, keep: ((lon: number, lat: number) => boolean) | null): boolean[] | null {
  if (!keep) return null;
  const hit = masks.get(part);
  if (hit && hit.keep === keep) return hit.inside;
  const inside = part.cells.map((c) => keep(...cellCentre(c)));
  masks.set(part, { keep, inside });
  return inside;
}

/**
 * Add a partition's rows into month x zone values.
 *  - monthly cell shards: zone = shard, cells filtered by `keep(lon, lat)`
 *  - zone-monthly: zone = the row's cell (a res-1 zone), no filter
 *  - daily cell partitions (live NRT): period folded to its month, zone = res-1 parent
 */
export function addMonthly(target: MonthZones, part: V2Partition, keep: ((lon: number, lat: number) => boolean) | null) {
  const zoneLevel = part.shard === "zones";
  const inside = insideMask(part, zoneLevel ? null : keep); // one point-in-polygon test per cell, not per row
  const zoneOf = zoneLevel ? null : part.cells.map((c) => (part.shard.length === 15 ? part.shard : cellToParent(c, 1)));
  for (const w of part.rows) {
    if (inside && !inside[w[0]]) continue;
    const zone = zoneLevel ? part.cells[w[0]] : zoneOf![w[0]];
    const period = part.periods[w[1]].slice(0, 7);
    let mz = target.get(period);
    if (!mz) target.set(period, (mz = new Map()));
    let z = mz.get(zone);
    if (!z) mz.set(zone, (z = zoneZero()));
    addTo(z.day, pvals(w[2])); addTo(z.night, pvals(w[3])); addTo(z.any, pvals(w[4]));
    for (let i = 0; i < 5; i++) { z.det[i] += w[5][i]; z.frp[i] += w[6][i]; }
  }
}

/** Make sure every listed month exists (an AOI month without rows is a zero, not a gap). */
export function ensureMonths(target: MonthZones, months: Iterable<string>) {
  for (const m of months) if (!target.has(m)) target.set(m, new Map());
}

/** Add a daily partition (cell shard or region totals) into day values. */
export function addDaily(target: DayVals, part: V2Partition, keep: ((lon: number, lat: number) => boolean) | null) {
  const inside = part.cells.length > 0 ? insideMask(part, keep) : null;
  for (const w of part.rows) {
    if (inside && !inside[w[0]]) continue;
    const d = part.periods[w[1]];
    let v = target.get(d);
    if (!v) target.set(d, (v = { ...ZERO(), det: [0, 0, 0, 0, 0] }));
    const p = pvals(w[4]);
    for (const k in p) v[k as PKey] += p[k as PKey];
    for (let i = 0; i < 5; i++) v.det[i] += w[5][i];
  }
}

// ---- harmonization ---------------------------------------------------------------

export type Method = "observed" | "terra-scaling" | "stratified" | "qm";
export type MonthResult = {
  month: string;
  cls: PeriodClass;
  method: Method;
  value: number | null; // MODIS-equivalent any-time fire-cell-days
  lo: number | null;
  hi: number | null;
  viirsLevel: number | null;
  viirsLevelEstimated: boolean;
  reference: PKey | null; // series whose daily shape distributes `value` over days
  viirsPlatform: string | null;
  raw: { any: PVals; day: PVals; night: PVals };
  det: number[];
  frp: number[];
  daysCovered: number;
  daysInMonth: number;
};

const lastOfMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const moy = (m: string) => +m.slice(5, 7);
const coef = (t: Calibration["viirsToModis"], zone: string, mo: number, o: "day" | "night") => t[`${zone}|${mo}|${o}`]?.k ?? t[`*|${mo}|${o}`]?.k ?? t[`*|*|${o}`]?.k ?? null;

export type HarmonizeOptions = {
  dataEnd: string; // last day with data (bundle planEnd, or the last live day)
  planEnd: string; // bundle end (VIIRS cover in the calibration is clipped here)
  regionX?: Map<string, number | null>; // whole-region VIIRS reference x per month (quantile mapping)
  aoiNoise?: boolean; // add Poisson sampling noise (AOIs smaller than the region)
  z?: number;
};

/** VIIRS cover extended past the bundle end for platforms still producing. */
function coverFor(cal: Calibration, o: HarmonizeOptions) {
  const cover: Record<string, readonly [string, string]> = {};
  for (const [p, c] of Object.entries(cal.viirsCover)) if (c) cover[p] = [c[0], c[1] === o.planEnd && o.dataEnd > o.planEnd ? o.dataEnd : c[1]];
  return cover;
}

export function harmonize(months: MonthZones, cal: Calibration, o: HarmonizeOptions): MonthResult[] {
  const cover = coverFor(cal, o);
  const cross = Object.fromEntries(Object.entries(cal.crossCalibration).map(([p, c]) => [p, c.k ?? undefined]));
  const z = o.z ?? 1.645;
  const out: MonthResult[] = [];
  for (const month of [...months.keys()].sort()) {
    const zones = months.get(month)!;
    const mo = moy(month);
    const cls = periodClass(month, cal.periods);
    const vstar = (v: PVals) => referenceViirs(month, { "S-NPP": v["S-NPP"], "NOAA-20": v["NOAA-20"], "NOAA-21": v["NOAA-21"] }, cover, cross, o.dataEnd);
    const raw = { any: ZERO(), day: ZERO(), night: ZERO() };
    const det = [0, 0, 0, 0, 0], frp = [0, 0, 0, 0, 0];
    for (const zv of zones.values()) {
      addTo(raw.any, zv.any); addTo(raw.day, zv.day); addTo(raw.night, zv.night);
      for (let i = 0; i < 5; i++) { det[i] += zv.det[i]; frp[i] += zv.frp[i]; }
    }
    const end = lastOfMonth(month) < o.dataEnd ? lastOfMonth(month) : o.dataEnd;
    const daysInMonth = +lastOfMonth(month).slice(8), daysCovered = +end.slice(8);
    const rho = cal.rho[String(mo)] ?? null;
    let value: number | null = null, method: Method = "observed", iv: Interval | null = null, reference: PKey | null = null;
    const vsAny = vstar(raw.any);
    if (cls === "modis-observed") {
      value = raw.any.M; reference = "M";
    } else if (cls === "terra-only-estimated") {
      method = "terra-scaling"; iv = cal.terraInterval90; reference = "Terra";
      let s = 0, ok = false;
      for (const [zone, zv] of zones) {
        const kd = coef(cal.terraToModis, zone, mo, "day"), kn = coef(cal.terraToModis, zone, mo, "night");
        if (kd == null || kn == null || rho == null) continue;
        s += combineOverpass(kd * zv.day.Terra, kn * zv.night.Terra, rho); ok = true;
      }
      value = ok || zones.size === 0 ? s : null;
    } else {
      iv = cal.interval90;
      reference = (vsAny.platform as PKey | null) ?? null;
      if (cal.selection.selected === "qm") {
        method = "qm";
        const xd = vstar(raw.day).value, xn = vstar(raw.night).value;
        const x = xd == null || xn == null ? null : xd + xn;
        const xr = o.regionX ? o.regionX.get(month) ?? null : x;
        value = x == null || xr == null ? null : xr > 0 ? (qmEstimate(cal.qm.x.length ? { v: cal.qm.x, m: cal.qm.m } : { v: [], m: [] }, xr, daysInMonth / daysCovered) * x) / xr : 0;
      } else {
        method = "stratified";
        let s = 0, ok = false;
        for (const [zone, zv] of zones) {
          const vd = vstar(zv.day).value, vn = vstar(zv.night).value;
          const kd = coef(cal.viirsToModis, zone, mo, "day"), kn = coef(cal.viirsToModis, zone, mo, "night");
          if (vd == null || vn == null || kd == null || kn == null || rho == null) continue;
          s += combineOverpass(kd * vd, kn * vn, rho); ok = true;
        }
        value = ok || zones.size === 0 ? s : null;
      }
    }
    let lo = value, hi = value;
    if (value != null && iv) {
      lo = value * iv.lo; hi = value * iv.hi;
      if (o.aoiNoise) { lo -= z * Math.sqrt(value); hi += z * Math.sqrt(value); }
      lo = Math.max(0, lo);
    }
    const ratio = cal.viirsLevel.modisToViirsByMoy[String(mo)];
    const viirsLevel = vsAny.value != null ? vsAny.value : value != null && ratio != null ? value * ratio : null;
    out.push({ month, cls, method, value, lo, hi, viirsLevel, viirsLevelEstimated: vsAny.value == null, reference, viirsPlatform: vsAny.platform, raw, det, frp, daysCovered, daysInMonth });
  }
  return out;
}

/** Whole-region VIIRS reference x (day + night) per month, for quantile mapping. */
export function regionReferenceX(regionMonths: MonthZones, cal: Calibration, o: Pick<HarmonizeOptions, "dataEnd" | "planEnd">): Map<string, number | null> {
  const cover = coverFor(cal, o);
  const cross = Object.fromEntries(Object.entries(cal.crossCalibration).map(([p, c]) => [p, c.k ?? undefined]));
  const out = new Map<string, number | null>();
  for (const [month, zones] of regionMonths) {
    const day = ZERO(), night = ZERO();
    for (const zv of zones.values()) { addTo(day, zv.day); addTo(night, zv.night); }
    const vs = (v: PVals) => referenceViirs(month, { "S-NPP": v["S-NPP"], "NOAA-20": v["NOAA-20"], "NOAA-21": v["NOAA-21"] }, cover, cross, o.dataEnd).value;
    const xd = vs(day), xn = vs(night);
    out.set(month, xd == null || xn == null ? null : xd + xn);
  }
  return out;
}

export type DayResult = { day: string; value: number | null; viirsLevel: number | null; raw: DayAgg; cls: PeriodClass };

/** Daily MODIS-equivalent and VIIRS-level values from each month's reference-sensor shape. */
export function harmonizeDays(days: DayVals, monthly: MonthResult[]): DayResult[] {
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  const out: DayResult[] = [];
  for (const d of [...days.keys()].sort()) {
    const raw = days.get(d)!;
    const m = byMonth.get(d.slice(0, 7));
    if (!m) { out.push({ day: d, value: null, viirsLevel: null, raw, cls: periodClass(d.slice(0, 7)) }); continue; }
    const share = (key: PKey | null, total: number | null) => (total == null || key == null ? null : m.raw.any[key] > 0 ? (total * raw[key]) / m.raw.any[key] : 0);
    const viirsKey = (m.viirsPlatform as PKey | null) ?? null;
    out.push({ day: d, value: share(m.reference, m.value), viirsLevel: m.viirsLevelEstimated ? share(m.reference, m.viirsLevel) : share(viirsKey, m.viirsLevel), raw, cls: m.cls });
  }
  return out;
}

export const PLATFORM_KEYS = PLATFORMS as unknown as PKey[];

export type CellIndex = { cells: string[]; rows: Array<[number, string[]]> };
/**
 * Classify res-1 shards against an AOI by their res-5 cell centres:
 * `full` (every cell inside: use the zone-monthly row), `partial` (download
 * the shard and filter), or neither (skip). Exact under the cell-centre rule.
 */
export function planAoi(index: CellIndex, keep: (lon: number, lat: number) => boolean) {
  const full: string[] = [], partial: string[] = [];
  let cellsInside = 0;
  for (const [i, cells] of index.rows) {
    let n = 0;
    for (const c of cells) if (keep(...cellCentre(c))) n++;
    cellsInside += n;
    if (n === cells.length && n > 0) full.push(index.cells[i]);
    else if (n > 0) partial.push(index.cells[i]);
  }
  return { full, partial, cellsInside };
}

/** Zone-monthly restricted to the given zones (shards fully inside an AOI). */
export function zonesOnly(zoneMonthly: V2Partition, zones: Set<string>): V2Partition {
  return { ...zoneMonthly, rows: zoneMonthly.rows.filter((w) => zones.has(zoneMonthly.cells[w[0]])) };
}
