import { describe, it, expect } from "vitest";
import { compareToHistory, median, normCdf, percentileRank, theilSen } from "./stats";

describe("history comparison", () => {
  it("reports median, % of median, mid-rank percentile, z-score and rank", () => {
    const c = compareToHistory(150, [100, 50, 200, 100])!;
    expect(c.median).toBe(100);
    expect(c.pctOfMedian).toBe(150);
    expect(c.mean).toBe(112.5);
    expect(c.pctOfMean!).toBeCloseTo(133.333, 3);
    expect(c.diffFromMean).toBe(37.5);
    expect(c.percentile).toBe(75);
    expect(c.rank).toBe(2);
    expect(c.of).toBe(5);
    expect(c.z!).toBeCloseTo((150 - 112.5) / 62.915, 3);
    expect(percentileRank([1, 2, 2, 3], 2)).toBe(50);
  });
  it("handles empty histories, zero medians and no spread", () => {
    expect(compareToHistory(5, [])).toBeNull();
    const c = compareToHistory(5, [0, 0, 0])!;
    expect(c.pctOfMedian).toBeNull();
    expect(c.pctOfMean).toBeNull();
    expect(c.z).toBeNull();
    expect(c.percentile).toBe(100);
    expect(median([3, 1, 2, 4])).toBe(2.5);
  });
});

describe("Theil–Sen / Mann–Kendall", () => {
  it("recovers a clean slope and finds it significant", () => {
    const t = theilSen(Array.from({ length: 20 }, (_, i) => ({ x: 2000 + i, y: 100 + 5 * i + (i % 3) })))!;
    expect(t.slope).toBeCloseTo(5, 0);
    expect(t.p).toBeLessThan(0.001);
    expect(t.slopeLo).toBeLessThanOrEqual(t.slope);
    expect(t.slopeHi).toBeGreaterThanOrEqual(t.slope);
    expect(t.pctPerDecade!).toBeGreaterThan(0);
  });
  it("is robust to an outlier and reports no trend for noise", () => {
    const ys = [10, 12, 9, 11, 10, 500, 11, 9, 10, 12, 11, 10];
    const t = theilSen(ys.map((y, i) => ({ x: i, y })))!;
    expect(Math.abs(t.slope)).toBeLessThan(0.5);
    expect(t.p).toBeGreaterThan(0.2);
    expect(theilSen([{ x: 0, y: 1 }, { x: 1, y: 2 }])).toBeNull();
  });
  it("normal CDF matches reference values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 4);
  });
});
