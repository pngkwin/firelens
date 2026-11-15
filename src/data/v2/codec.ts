// Shared v2 data codec (browser + Node publish/verify scripts).
//
// A histogram maps a platform bitmask to the number of fire-cell-days whose
// set of detecting platforms equals that mask. Stored flat and sorted:
// [mask1, count1, mask2, count2, ...]. Unions, intersections and per-platform
// counts are exact, and histograms add across cells and periods.

export const BIT = { Terra: 1, Aqua: 2, "S-NPP": 4, "NOAA-20": 8, "NOAA-21": 16 } as const;
export type Platform = keyof typeof BIT;
export const PLATFORMS = Object.keys(BIT) as Platform[];
export const MODIS = BIT.Terra | BIT.Aqua;
export const VIIRS = BIT["S-NPP"] | BIT["NOAA-20"] | BIT["NOAA-21"];
export const ALL = MODIS | VIIRS;

export type FlatHist = number[];

export function encodeHist(hist: Record<string | number, number>): FlatHist {
  const out: FlatHist = [];
  for (const k of Object.keys(hist).map(Number).sort((a, b) => a - b)) {
    if (!Number.isInteger(k) || k < 1 || k > ALL) throw Error(`Invalid platform mask ${k}`);
    const v = hist[k];
    if (!Number.isInteger(v) || v < 0) throw Error(`Invalid count ${v}`);
    if (v) out.push(k, v);
  }
  return out;
}

export function decodeHist(flat: FlatHist): Record<number, number> {
  if (flat.length % 2) throw Error("Histogram must have mask/count pairs");
  const out: Record<number, number> = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

/** Cell-days detected by at least one platform in `subset`. */
export function union(flat: FlatHist, subset: number): number {
  let n = 0;
  for (let i = 0; i < flat.length; i += 2) if (flat[i] & subset) n += flat[i + 1];
  return n;
}

/** Cell-days detected by a platform in `a` AND a platform in `b`. */
export function both(flat: FlatHist, a: number, b: number): number {
  let n = 0;
  for (let i = 0; i < flat.length; i += 2) if (flat[i] & a && flat[i] & b) n += flat[i + 1];
  return n;
}

export function addHist(a: FlatHist, b: FlatHist): FlatHist {
  const m = decodeHist(a);
  for (let i = 0; i < b.length; i += 2) m[b[i]] = (m[b[i]] ?? 0) + b[i + 1];
  return encodeHist(m);
}

/** One aggregate row: a res-5 cell (or a whole region) over one period. */
export type V2Row = {
  day: FlatHist;
  night: FlatHist;
  any: FlatHist;
  det: number[]; // detections per platform, PLATFORMS order
  frp: number[]; // summed FRP (MW) per platform, PLATFORMS order
};

/** Wire form: [cellIndex, periodIndex, day, night, any, det, frp]. */
export type WireRow = [number, number, FlatHist, FlatHist, FlatHist, number[], number[]];

export type V2Partition = {
  v: 2;
  region: string;
  kind: "monthly" | "daily";
  res: number;
  shard: string; // res-1 parent cell, or "region" for whole-region totals
  periods: string[]; // YYYY-MM or YYYY-MM-DD
  cells: string[]; // H3 indexes (empty for region totals; cellIndex = -1)
  rows: WireRow[];
};

export function sumRows(rows: V2Row[]): V2Row {
  const out: V2Row = { day: [], night: [], any: [], det: [0, 0, 0, 0, 0], frp: [0, 0, 0, 0, 0] };
  for (const r of rows) {
    out.day = addHist(out.day, r.day);
    out.night = addHist(out.night, r.night);
    out.any = addHist(out.any, r.any);
    for (let i = 0; i < 5; i++) {
      out.det[i] += r.det[i];
      out.frp[i] += r.frp[i];
    }
  }
  return out;
}

export const fromWire = (w: WireRow): V2Row => ({ day: w[2], night: w[3], any: w[4], det: w[5], frp: w[6] });
