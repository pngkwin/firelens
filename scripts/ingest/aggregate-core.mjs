// Fire-cell-day aggregation core.
//
// Unit of analysis: a fire-cell-day = one H3 resolution-8 cell (~0.74 km²,
// close to a nadir MODIS 1 km pixel) on one UTC day with >= 1 detection.
// Many VIIRS 375 m pixels in one MODIS-sized cell collapse to one cell-day,
// which removes most of the pixel-size effect on counts.
//
// For each cell-day we keep a bitmask of which platforms detected fire, for
// day, night and either overpass. Coarse outputs store sparse histograms
// {mask: number of cell-days}, so any union ("any sensor"), per-platform count
// or intersection (agreement) is exact and additive across cells and periods.
import { latLngToCell, cellToParent } from "h3-js";

export const FINE_RES = 8;
export const PLATFORM_BIT = { Terra: 1, Aqua: 2, "S-NPP": 4, "NOAA-20": 8, "NOAA-21": 16 };
export const PLATFORMS = Object.keys(PLATFORM_BIT);
export const MODIS_MASK = 1 | 2;
export const VIIRS_MASK = 4 | 8 | 16;
export const ALL_MASK = 31;

const ALIAS = {
  t: "Terra", terra: "Terra", a: "Aqua", aqua: "Aqua",
  n: "S-NPP", snpp: "S-NPP", "s-npp": "S-NPP", npp: "S-NPP",
  n20: "NOAA-20", "noaa-20": "NOAA-20", j1: "NOAA-20",
  n21: "NOAA-21", "noaa-21": "NOAA-21", j2: "NOAA-21",
};
export function platformOf(sat) {
  const p = ALIAS[String(sat).trim().toLowerCase()];
  if (!p) throw Error(`Unknown satellite code: ${sat}`);
  return p;
}

/** Number of cell-days whose mask intersects `subset` (union over platforms). */
export function unionCount(hist, subset) {
  let n = 0;
  for (const k in hist) if (k & subset) n += hist[k];
  return n;
}
/** Number of cell-days detected by BOTH a platform in `a` and one in `b`. */
export function maskMatches(hist, a, b) {
  let n = 0;
  for (const k in hist) if (k & a && k & b) n += hist[k];
  return n;
}

const bump = (o, k, v = 1) => { o[k] = (o[k] ?? 0) + v; };

export class CellDayAccumulator {
  constructor({ staticCells = null, start = null, end = null, inRegion = null } = {}) {
    this.inRegion = inRegion;
    this.outsideRegion = 0;
    this.staticCells = staticCells;
    this.start = start;
    this.end = end;
    this.cells = new Map(); // `${cell8}|${date}` -> {d, n, det:{}, frp:{}}
    this.excludedStatic = 0;
    this.outOfWindow = 0;
    this.rejected = 0;
    this.accepted = 0;
  }

  add(row) {
    const lat = +row.latitude, lon = +row.longitude, date = row.acq_date;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
      this.rejected++;
      return;
    }
    if ((this.start && date < this.start) || (this.end && date > this.end)) {
      this.outOfWindow++;
      return;
    }
    let platform;
    try { platform = platformOf(row.satellite); } catch { this.rejected++; return; }
    const cell = latLngToCell(lat, lon, FINE_RES);
    if (this.inRegion && !this.inRegion(cell)) {
      this.outsideRegion++;
      return;
    }
    if (this.staticCells?.has(cell)) {
      this.excludedStatic++;
      return;
    }
    const key = `${cell}|${date}`;
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = { d: 0, n: 0, det: {}, frp: {} }));
    const bit = PLATFORM_BIT[platform];
    if (String(row.daynight).trim().toUpperCase() === "N") c.n |= bit;
    else c.d |= bit;
    bump(c.det, platform);
    const frp = row.frp === "" || row.frp == null ? NaN : +row.frp;
    if (Number.isFinite(frp)) bump(c.frp, platform, frp);
    this.accepted++;
  }

  /**
   * Roll fine cell-days up to coarse H3 cells per month or day.
   * Returns rows {cell, period, any, day, night, det, frp} with sparse
   * mask histograms.
   */
  coarse(res, by = "month") {
    const out = new Map();
    for (const [key, c] of this.cells) {
      const [cell8, date] = key.split("|");
      const cell = cellToParent(cell8, res);
      const period = by === "month" ? date.slice(0, 7) : date;
      const k = `${cell}|${period}`;
      let r = out.get(k);
      if (!r) out.set(k, (r = { cell, period, any: {}, day: {}, night: {}, det: {}, frp: {} }));
      bump(r.any, c.d | c.n);
      if (c.d) bump(r.day, c.d);
      if (c.n) bump(r.night, c.n);
      for (const p in c.det) bump(r.det, p, c.det[p]);
      for (const p in c.frp) bump(r.frp, p, c.frp[p]);
    }
    return [...out.values()].sort((a, b) => (a.cell < b.cell ? -1 : a.cell > b.cell ? 1 : a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  }
}
