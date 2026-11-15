import { describe, it, expect } from "vitest";
import { annualTotals, annualTrend, climatology, compareFocus, monthInterval, monthValue, rankMonths } from "./analysis";
import type { DayResult, MonthResult, PVals } from "./series";

const pv = (n: number): PVals => ({ M: n, Terra: n, Aqua: 0, "S-NPP": n * 2, "NOAA-20": 0, "NOAA-21": 0, V: n * 2, ALL: n * 2 });
const days = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
function month(m: string, value: number, o: Partial<MonthResult> = {}): MonthResult {
  const est = m >= "2022-01";
  return {
    month: m, cls: est ? "viirs-estimated" : "modis-observed", method: est ? "stratified" : "observed",
    value, lo: est ? value * 0.9 : value, hi: est ? value * 1.1 : value, viirsLevel: value * 2, viirsLevelEstimated: m < "2012-01",
    reference: "M", viirsPlatform: null, raw: { any: pv(value), day: pv(value), night: pv(0) }, det: [0, 0, 0, 0, 0], frp: [0, 0, 0, 0, 0],
    daysCovered: days(m), daysInMonth: days(m), ...o,
  };
}

describe("scales and intervals", () => {
  it("returns values per scale and intervals only for estimated values", () => {
    const obs = month("2015-08", 100), est = month("2024-08", 100), old = month("2005-08", 50);
    expect(monthValue(est, "raw-viirs")).toBe(200);
    expect(monthInterval(obs, "modis-eq")).toBeNull();
    const iv = monthInterval(est, "modis-eq")!;
    expect(iv[0]).toBeCloseTo(90, 9);
    expect(iv[1]).toBeCloseTo(110, 9);
    expect(monthInterval(est, "raw-all")).toBeNull();
    expect(monthInterval(old, "viirs-level")).toBeNull(); // lo == hi == value for observed MODIS
    expect(monthInterval({ ...old, cls: "terra-only-estimated", lo: 40, hi: 60 }, "viirs-level")).toEqual([80, 120]);
  });
});

describe("rankings and annual totals", () => {
  const rs = [month("2020-07", 50), month("2020-08", 300), month("2021-08", 200), month("2024-08", 250)];
  it("ranks months with estimate flags", () => {
    const top = rankMonths(rs, "modis-eq", 2);
    expect(top.map((t) => t.key)).toEqual(["2020-08", "2024-08"]);
    expect(top[1]).toMatchObject({ estimated: true });
    expect(top[1].lo!).toBeCloseTo(225, 9);
    expect(top[1].hi!).toBeCloseTo(275, 9);
  });
  it("sums years, flags partial years and sums interval bounds", () => {
    const a = annualTotals(rs, "modis-eq");
    expect(a.map((x) => [x.year, x.value, x.partial])).toEqual([[2020, 350, true], [2021, 200, true], [2024, 250, true]]);
    expect(a[2].estimatedMonths).toBe(1);
    expect(a[2].lo).toBeCloseTo(225, 9);
    expect(a[2].hi).toBeCloseTo(275, 9);
  });
  it("fits a trend over complete years only", () => {
    const full = [];
    for (let y = 2003; y <= 2020; y++) for (let m = 1; m <= 12; m++) full.push(month(`${y}-${String(m).padStart(2, "0")}`, 10 + (y - 2003)));
    full.push(month("2021-01", 1e6)); // partial year: ignored
    const t = annualTrend(annualTotals(full, "modis-eq"), 2000, 2030)!;
    expect(t.n).toBe(18);
    expect(t.slope).toBeCloseTo(12, 6);
  });
  it("computes month-of-year climatology from complete months", () => {
    const c = climatology([...rs, month("2026-08", 9999, { daysCovered: 3 })], "modis-eq");
    expect(c[7]).toEqual({ moy: 8, median: 250, max: 300, n: 3 });
    expect(c[0].median).toBeNull();
  });
});

describe("focus month vs history", () => {
  const hist = [2019, 2020, 2021].map((y, i) => month(`${y}-11`, [100, 200, 300][i]));
  it("compares a complete month on monthly totals", () => {
    const f = compareFocus([...hist, month("2025-11", 400)], null, "2025-11", "modis-eq")!;
    expect(f.mode).toBe("full-month");
    expect(f.stats).toMatchObject({ median: 200, pctOfMedian: 200, rank: 1, of: 4 });
    expect(f.boundsAgree).toBe("above"); // interval [360, 440] above the median
  });
  it("compares a partial month month-to-date using daily values", () => {
    const cur = month("2026-11", 60, { daysCovered: 10 });
    const dayRows: DayResult[] = [];
    for (const y of [2019, 2020, 2021]) for (let d = 1; d <= 30; d++)
      dayRows.push({ day: `${y}-11-${String(d).padStart(2, "0")}`, value: d <= 10 ? 5 : 1, viirsLevel: null, raw: { ...pv(1), det: [0, 0, 0, 0, 0] }, cls: "modis-observed" });
    expect(compareFocus([...hist, cur], null, "2026-11", "modis-eq")).toBeNull(); // needs daily data
    const f = compareFocus([...hist, cur], dayRows, "2026-11", "modis-eq")!;
    expect(f.mode).toBe("month-to-date");
    expect(f.throughDay).toBe(10);
    expect(f.history.map((h) => h.value)).toEqual([50, 50, 50]);
    expect(f.stats!.pctOfMedian).toBe(120);
    expect(f.boundsAgree).toBe("above"); // interval [54, 66] lies above the median 50
  });
});

describe("per-month anomalies", () => {
  it("compares every month with the same month in all other complete years (median and multi-year average)", async () => {
    const { monthAnomalies } = await import("./analysis");
    const rs = [month("2019-08", 100), month("2020-08", 200), month("2021-08", 600), month("2021-09", 50)];
    const a = monthAnomalies(rs, "modis-eq");
    expect(a.get("2021-08")).toMatchObject({ median: 150, mean: 150, pctOfMedian: 400, pctOfMean: 400, n: 2 });
    expect(a.get("2021-09")).toBeNull(); // no other September
  });
  it("adds anomaly columns to the monthly CSV", async () => {
    const { monthAnomalies } = await import("./analysis");
    const { monthlyCsv } = await import("./exportsV2");
    const rs = [month("2019-08", 100), month("2020-08", 300)];
    const [head, row] = monthlyCsv(rs, monthAnomalies(rs, "modis-eq")).trim().split("\n");
    const cols = head.split(",");
    expect(cols.slice(-7)).toEqual(["same_month_years", "same_month_median", "same_month_mean", "pct_of_median", "pct_of_mean", "z_score", "percentile"]);
    expect(row.split(",").slice(-7)).toEqual(["1", "300.0", "300.0", "33.3", "33.3", "", "0.0"]);
  });
});

describe("hotspot-count scales", () => {
  it("count FIRMS detections per sensor family without adding sensors together", async () => {
    const { monthValue, dayValue, SCALES } = await import("./analysis");
    const r = { ...month("2024-08", 10), det: [3, 4, 20, 30, 40] };
    expect(monthValue(r, "hotspots-modis")).toBe(7);
    expect(monthValue(r, "hotspots-viirs")).toBe(90);
    expect(SCALES["hotspots-viirs"].unit).toBe("hotspots");
    expect(SCALES["modis-eq"].label).toMatch(/MODIS-equivalent hotspots/);
    const d = { day: "2024-08-01", value: 1, viirsLevel: 2, cls: "viirs-estimated" as const, raw: { ...pv(1), det: [1, 0, 2, 2, 2] } };
    expect(dayValue(d, "hotspots-modis")).toBe(1);
    expect(dayValue(d, "hotspots-viirs")).toBe(6);
  });
});
