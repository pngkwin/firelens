// Fire episodes ("events"): fire cells that touch in space and occur within
// one day of each other. Cells are H3 resolution-5 (~250 km²), the finest
// resolution in the daily bundle. Clustering runs on the selected area's cells
// only, so activity outside the area never merges into an in-area episode.
// Persistent agricultural or prescribed burning in neighbouring cells chains
// into long episodes; size, duration and cell count are therefore all shown.
import { gridDisk } from "h3-js";
import { pvals, type DayAgg, type MonthResult, type PKey } from "./series";
import type { V2Partition } from "./codec";
import type { Scale } from "./analysis";

export type FireEvent = {
  start: string;
  end: string;
  days: number; // duration, first to last day inclusive
  cells: number; // distinct res-5 cells
  cellDays: number; // res-5 cell-days
  byDay: Map<string, DayAgg>; // per-day totals within the event
  centre: [number, number]; // lon, lat of the cell with the most fire-cell-days
};

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/**
 * Cluster daily cell partitions into episodes. `inside` filters cells (AOI);
 * partitions may overlap in days (bundle + live) as long as each cell-day
 * appears once.
 */
export function buildEvents(parts: V2Partition[], inside: ((cell: string) => boolean) | null): FireEvent[] {
  const cellId = new Map<string, number>(), cells: string[] = [];
  const nodeKey: number[] = [], nodeCell: number[] = [], nodeDay: number[] = [], nodeVal: DayAgg[] = [];
  const index = new Map<number, number>(); // cellId * 1e6 + dayNum -> node
  const KEY = 1e6;
  for (const p of parts) {
    if (!p.cells.length) continue;
    const keep = p.cells.map((c) => !inside || inside(c));
    for (const w of p.rows) {
      if (!keep[w[0]]) continue;
      const cell = p.cells[w[0]];
      let ci = cellId.get(cell);
      if (ci == null) { ci = cells.length; cellId.set(cell, ci); cells.push(cell); }
      const dn = dayNum(p.periods[w[1]]), key = ci * KEY + dn;
      let ni = index.get(key);
      if (ni == null) {
        ni = nodeKey.length; index.set(key, ni);
        nodeKey.push(key); nodeCell.push(ci); nodeDay.push(dn); nodeVal.push({ ...pvals([]), det: [0, 0, 0, 0, 0] });
      }
      const v = nodeVal[ni], pv = pvals(w[4]);
      for (const k in pv) v[k as PKey] += pv[k as PKey];
      for (let i = 0; i < 5; i++) v.det[i] += w[5][i];
    }
  }
  const n = nodeKey.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const neighbours: number[][] = cells.map((c) => gridDisk(c, 1).map((x) => cellId.get(x)).filter((x): x is number => x != null));
  for (let i = 0; i < n; i++) {
    for (const nc of neighbours[nodeCell[i]]) for (const dd of [0, -1, 1]) {
      const j = index.get(nc * KEY + nodeDay[i] + dd);
      if (j != null && j !== i) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) { const r = find(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]); }
  const out: FireEvent[] = [];
  for (const members of groups.values()) {
    let d0 = Infinity, d1 = -Infinity;
    const byDay = new Map<string, DayAgg>(), perCell = new Map<number, number>();
    for (const i of members) {
      d0 = Math.min(d0, nodeDay[i]); d1 = Math.max(d1, nodeDay[i]);
      const ds = dayStr(nodeDay[i]);
      const t = byDay.get(ds) ?? { ...pvals([]), det: [0, 0, 0, 0, 0] };
      const v = nodeVal[i];
      for (const k in v) if (k !== "det") t[k as PKey] += v[k as PKey];
      for (let k = 0; k < 5; k++) t.det[k] += v.det[k];
      byDay.set(ds, t);
      perCell.set(nodeCell[i], (perCell.get(nodeCell[i]) ?? 0) + v.ALL);
    }
    let top = members[0] && nodeCell[members[0]], topV = -1;
    for (const [c, v] of perCell) if (v > topV) { topV = v; top = c; }
    const [lat, lon] = cellCentreLatLon(cells[top]);
    out.push({ start: dayStr(d0), end: dayStr(d1), days: d1 - d0 + 1, cells: perCell.size, cellDays: members.length, byDay, centre: [lon, lat] });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

import { cellToLatLng } from "h3-js";
const cellCentreLatLon = (c: string) => cellToLatLng(c);

/**
 * An episode's size on a scale. Harmonized scales distribute each month's
 * area estimate by the month's reference sensor (as daily values do):
 * size = Σ_day value_month × ref_day / ref_month.
 */
export function eventSize(e: FireEvent, scale: Scale, months: Map<string, MonthResult>): { total: number; peakDay: string; peak: number } {
  let total = 0, peak = -1, peakDay = e.start;
  for (const [d, v] of e.byDay) {
    let x: number;
    if (scale === "modis-eq" || scale === "viirs-level") {
      const m = months.get(d.slice(0, 7));
      const val = scale === "modis-eq" ? m?.value : m?.viirsLevel;
      const key = scale === "modis-eq" || m?.viirsLevelEstimated ? m?.reference : (m?.viirsPlatform as PKey | null);
      x = m && val != null && key && m.raw.any[key] > 0 ? (val * v[key]) / m.raw.any[key] : 0;
    } else if (scale === "raw-all") x = v.ALL;
    else if (scale === "raw-modis") x = v.M;
    else if (scale === "raw-viirs") x = v.V;
    else if (scale === "hotspots-modis") x = v.det[0] + v.det[1];
    else x = v.det[2] + v.det[3] + v.det[4];
    total += x;
    if (x > peak) { peak = x; peakDay = d; }
  }
  return { total, peakDay, peak: Math.max(0, peak) };
}

export type RankedEvent = FireEvent & { size: number; peak: number; peakDay: string; rankSize: number; pctSize: number; pctDays: number; pctPeak: number };

/**
 * Current episodes (active within the last `recentDays` before `dataEnd`)
 * ranked against all earlier episodes in the area, by size, duration and
 * peak-day value. Percentiles are mid-rank (% of past episodes below, ties half).
 */
export function rankEvents(events: FireEvent[], scale: Scale, months: Map<string, MonthResult>, dataEnd: string, recentDays = 7) {
  const cutoff = dayStr(dayNum(dataEnd) - recentDays + 1);
  const sized = events.map((e) => ({ ...e, ...(() => { const s = eventSize(e, scale, months); return { size: s.total, peak: s.peak, peakDay: s.peakDay }; })() }));
  const current = sized.filter((e) => e.end >= cutoff);
  const past = sized.filter((e) => e.end < cutoff);
  const pct = (xs: number[], x: number) => { if (!xs.length) return NaN; let b = 0, q = 0; for (const v of xs) { if (v < x) b++; else if (v === x) q++; } return (100 * (b + q / 2)) / xs.length; };
  const ps = past.map((e) => e.size), pd = past.map((e) => e.days), pp = past.map((e) => e.peak);
  const rank = (e: (typeof sized)[number]): RankedEvent => ({ ...e, rankSize: 1 + past.filter((p) => p.size > e.size).length, pctSize: pct(ps, e.size), pctDays: pct(pd, e.days), pctPeak: pct(pp, e.peak) });
  return {
    current: current.map(rank).sort((a, b) => b.size - a.size),
    largestPast: past.sort((a, b) => b.size - a.size).slice(0, 10),
    pastCount: past.length,
    cutoff,
  };
}
