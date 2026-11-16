import { describe, it, expect } from "vitest";
import { criticalPeriods, dailyClimatology, doyIndex, doyLabel, historicalOutlook, inPeriod, recentWindow, sameDayIn } from "./earlyWarning";
import type { DayResult, PVals } from "./series";

const pv0: PVals = { M: 0, Terra: 0, Aqua: 0, "S-NPP": 0, "NOAA-20": 0, "NOAA-21": 0, V: 0, ALL: 0 };
const mk = (from: string, to: string, f: (d: string) => number) => {
  const out: DayResult[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, value: f(day), viirsLevel: null, raw: { ...pv0, det: [0, 0, 0, 0, 0] }, cls: "modis-observed", flagged: [] });
  }
  return out;
};
// Every year: fire season Jul 1 – Aug 31 at 10/day, otherwise 1/day.
const season = (d: string) => (d.slice(5) >= "07-01" && d.slice(5) <= "08-31" ? 10 : 1);

describe("recent windows", () => {
  it("compare the last N days with the same window in every earlier year", () => {
    const days = mk("2010-01-01", "2014-08-10", (d) => (d >= "2014-08-04" ? 100 : season(d)));
    const w = recentWindow(days, "2014-08-10", 7, "modis-eq", "2010-01-01");
    expect(w.start).toBe("2014-08-04");
    expect(w.value).toBe(700);
    expect(w.history.map((h) => [h.year, h.value])).toEqual([[2010, 70], [2011, 70], [2012, 70], [2013, 70]]);
    expect(w.stats!.pctOfMedian).toBe(1000);
    expect(w.stats!.rank).toBe(1);
  });
  it("count days without rows as zeros and skip windows before coverage", () => {
    const days = mk("2011-03-01", "2013-03-10", () => 2).filter((d) => d.day.slice(8) !== "05");
    const w = recentWindow(days, "2013-03-10", 10, "modis-eq", "2011-03-01");
    expect(w.value).toBe(18);
    expect(w.history.map((h) => h.year)).toEqual([2011, 2012]);
  });
  it("maps Feb 29 to Feb 28 in other years", () => {
    expect(sameDayIn(2023, "2024-02-29")).toBe("2023-02-28");
    expect(doyIndex("2024-02-29")).toBe(doyIndex("2023-02-28"));
  });
});

describe("critical periods", () => {
  it("are found from the daily climatology", () => {
    const c = dailyClimatology(mk("2005-01-01", "2012-12-31", season), "modis-eq", "2005-01-01", "2012-12-31", 1);
    expect(c.years).toBe(8);
    const p = criticalPeriods(c.median, 0.5);
    expect(p).toHaveLength(1);
    expect([doyLabel(p[0].start), doyLabel(p[0].end)]).toEqual(["Jul 1", "Aug 31"]);
    expect(inPeriod(p[0], doyIndex("2026-08-15"))).toBe(true);
    expect(inPeriod(p[0], doyIndex("2026-11-15"))).toBe(false);
  });
  it("can wrap the new year, and are empty without activity", () => {
    const clim = Array.from({ length: 365 }, (_, i) => (i < 20 || i > 350 ? 10 : 1));
    const p = criticalPeriods(clim, 0.5);
    expect(p).toHaveLength(1);
    expect([doyLabel(p[0].start), doyLabel(p[0].end)]).toEqual(["Dec 18", "Jan 20"]);
    expect(inPeriod(p[0], 5)).toBe(true);
    expect(criticalPeriods(Array(365).fill(0))).toEqual([]);
  });
});

describe("historical outlook", () => {
  it("summarizes the coming weeks in earlier years", () => {
    const days = mk("2005-01-01", "2012-06-30", (d) => (d.slice(0, 4) === "2008" ? 3 * season(d) : season(d)));
    const o = historicalOutlook(days, "2012-06-30", 28, "modis-eq", "2005-01-01", "2012-06-30");
    expect([o.start, o.end]).toEqual(["2012-07-01", "2012-07-28"]);
    expect(o.years).toBe(7);
    expect(o.median).toBe(280);
    expect(o.max).toEqual({ year: 2008, value: 840 });
  });
});
