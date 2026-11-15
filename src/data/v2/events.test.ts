import { describe, it, expect } from "vitest";
import { latLngToCell, gridDisk, gridDistance } from "h3-js";
import { buildEvents, eventSize, rankEvents } from "./events";
import type { V2Partition, WireRow } from "./codec";
import type { MonthResult } from "./series";

const a = latLngToCell(37, -120, 5);
const nbr = gridDisk(a, 1).find((c) => c !== a)!;
const far = gridDisk(a, 3).find((c) => gridDistance(a, c) === 3)!;
// one row = one res-5 cell-day with `n` NOAA-20 fire-cell-days and `d` detections
const row = (ci: number, pi: number, n: number, d = n): WireRow => [ci, pi, [8, n], [], [8, n], [0, 0, 0, d, 0], [0, 0, 0, 0, 0]];
const part = (periods: string[], cells: string[], rows: WireRow[]): V2Partition => ({ v: 2, region: "t", kind: "daily", res: 5, shard: "x", periods, cells, rows });

describe("fire episodes", () => {
  it("join cells that touch in space within one day, and split by gaps or distance", () => {
    const p = part(["2024-08-01", "2024-08-02", "2024-08-03", "2024-08-05"], [a, nbr, far], [
      row(0, 0, 5), // a, day 1
      row(1, 1, 3), // neighbour, day 2 -> same episode
      row(0, 3, 2), // a, day 5 (gap of 2 days after day 3? no activity day 3/4) -> new episode
      row(2, 1, 4), // far cell, day 2 -> separate episode
    ]);
    const ev = buildEvents([p], null);
    expect(ev.map((e) => [e.start, e.end, e.cells, e.cellDays])).toEqual([
      ["2024-08-01", "2024-08-02", 2, 2],
      ["2024-08-02", "2024-08-02", 1, 1],
      ["2024-08-05", "2024-08-05", 1, 1],
    ]);
  });

  it("only uses cells inside the area, so outside activity cannot bridge episodes", () => {
    const p = part(["2024-08-01", "2024-08-02", "2024-08-03"], [a, nbr], [row(0, 0, 1), row(1, 1, 1), row(0, 2, 1)]);
    expect(buildEvents([p], null)).toHaveLength(1);
    expect(buildEvents([p], (c) => c === a)).toHaveLength(2); // the bridging neighbour is outside
  });

  it("sizes episodes on raw and harmonized scales and ranks current ones against the past", () => {
    const days = ["2020-08-01", "2020-08-02", "2021-08-01", "2024-08-10", "2024-08-11"];
    const p = part(days, [a, nbr], [row(0, 0, 10), row(1, 1, 10), row(0, 2, 2), row(0, 3, 30, 60), row(1, 4, 6)]);
    const ev = buildEvents([p], null);
    const month = (m: string, value: number, ref: number): MonthResult => ({
      month: m, cls: "viirs-estimated", method: "stratified", value, lo: value, hi: value, viirsLevel: ref, viirsLevelEstimated: false, reference: "NOAA-20", viirsPlatform: "NOAA-20",
      raw: { any: { M: 0, Terra: 0, Aqua: 0, "S-NPP": 0, "NOAA-20": ref, "NOAA-21": 0, V: ref, ALL: ref }, day: {} as never, night: {} as never }, det: [0, 0, 0, 0, 0], frp: [0, 0, 0, 0, 0], daysCovered: 31, daysInMonth: 31,
    });
    const months = new Map([["2020-08", month("2020-08", 10, 20)], ["2021-08", month("2021-08", 1, 2)], ["2024-08", month("2024-08", 18, 36)]]);
    expect(eventSize(ev[2], "raw-all", months)).toEqual({ total: 36, peakDay: "2024-08-10", peak: 30 });
    expect(eventSize(ev[2], "modis-eq", months).total).toBeCloseTo(18); // half of VIIRS, as the month's estimate says
    expect(eventSize(ev[2], "hotspots-viirs", months).total).toBe(66);
    const r = rankEvents(ev, "raw-all", months, "2024-08-12", 7);
    expect(r.pastCount).toBe(2);
    expect(r.current).toHaveLength(1);
    expect(r.current[0]).toMatchObject({ size: 36, days: 2, rankSize: 1, pctSize: 100, pctDays: 75 });
    expect(r.largestPast.map((e) => e.size)).toEqual([20, 2]);
  });
});
