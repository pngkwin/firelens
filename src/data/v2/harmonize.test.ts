import { describe, expect, it } from "vitest";
import {
  fitRatio,
  fitStratified,
  looIntervals,
  quantileMapFit,
  quantileMapApply,
  referenceViirs,
  periodClass,
  metrics,
  combineOverpass,
} from "./harmonize";

describe("ratio calibration", () => {
  it("recovers an exact MODIS/VIIRS ratio (ratio of sums)", () => {
    const pts = [10, 20, 40, 80].map((v) => ({ m: 0.4 * v, v }));
    expect(fitRatio(pts).k).toBeCloseTo(0.4, 10);
  });

  it("shrinks sparse strata toward the parent ratio with pseudo-count kappa", () => {
    // 2 VIIRS cell-days observed with 2 MODIS (raw ratio 1.0), parent 0.4, kappa 20
    const r = fitRatio([{ m: 2, v: 2 }], { parent: 0.4, kappa: 20 });
    expect(r.k).toBeCloseTo((2 + 20 * 0.4) / (2 + 20), 10);
    // with lots of data the parent barely matters
    const big = fitRatio([{ m: 1000, v: 1000 }], { parent: 0.4, kappa: 20 });
    expect(big.k).toBeGreaterThan(0.98);
  });

  it("returns the parent (or null) when a stratum has no VIIRS signal", () => {
    expect(fitRatio([{ m: 0, v: 0 }], { parent: 0.5, kappa: 20 }).k).toBeCloseTo(0.5);
    expect(fitRatio([{ m: 0, v: 0 }]).k).toBeNull();
  });

  it("fits zone x month-of-year x overpass strata with zone -> region shrinkage", () => {
    const rows = [];
    for (let y = 2012; y <= 2019; y++)
      for (const o of ["day", "night"] as const) {
        rows.push({ zone: "A", year: y, moy: 8, o, m: o === "day" ? 50 : 10, v: 100 });
        rows.push({ zone: "B", year: y, moy: 8, o, m: o === "day" ? 25 : 5, v: 100 });
      }
    const t = fitStratified(rows, { kappa: 20 });
    expect(t.get("A|8|day")!.k).toBeCloseTo(0.5, 2);
    expect(t.get("B|8|night")!.k).toBeCloseTo(0.05, 2);
    expect(t.get("*|8|day")!.k).toBeCloseTo(0.375, 2); // region pools A and B
  });
});

describe("leave-one-year-out prediction intervals", () => {
  it("cover held-out values at about the nominal rate under multiplicative noise", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = [];
    for (let y = 2000; y < 2040; y++) {
      const v = 200 + 100 * rnd();
      const noise = Math.exp((rnd() - 0.5) * 0.6);
      rows.push({ year: y, m: 0.4 * v * noise, v });
    }
    const { lo, hi, coverage } = looIntervals(rows, 0.9);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(1);
    expect(coverage).toBeGreaterThan(0.8);
    expect(coverage).toBeLessThanOrEqual(1);
  });
});

describe("quantile mapping", () => {
  it("maps VIIRS values onto the MODIS distribution monotonically", () => {
    const v = [10, 20, 30, 40, 50];
    const m = [4, 8, 12, 16, 20];
    const qm = quantileMapFit(v, m);
    expect(quantileMapApply(qm, 30)).toBeCloseTo(12, 6);
    expect(quantileMapApply(qm, 25)).toBeCloseTo(10, 6);
    expect(quantileMapApply(qm, 60)).toBeCloseTo(24, 6); // ratio-extrapolated beyond range
    expect(quantileMapApply(qm, 0)).toBe(0);
  });
});

describe("VIIRS reference series", () => {
  const cover = { "S-NPP": ["2012-01-20", "2026-11-02"], "NOAA-20": ["2018-04-01", "2026-11-14"], "NOAA-21": ["2023-03-01", "2026-11-14"] } as const;
  it("uses S-NPP while it covers the full month", () => {
    const r = referenceViirs("2020-05", { "S-NPP": 100, "NOAA-20": 120, "NOAA-21": 0 }, cover, { "NOAA-20": 0.8, "NOAA-21": 0.75 });
    expect(r).toEqual({ value: 100, platform: "S-NPP", loss: 0, reduced: false });
  });
  it("switches to cross-calibrated NOAA-20 when S-NPP covers only part of the month", () => {
    const r = referenceViirs("2026-11", { "S-NPP": 5, "NOAA-20": 120, "NOAA-21": 110 }, cover, { "NOAA-20": 0.8, "NOAA-21": 0.75 }, "2026-11-14");
    expect(r.platform).toBe("NOAA-20");
    expect(r.value).toBeCloseTo(96);
  });
  it("is null before any VIIRS platform", () => {
    expect(referenceViirs("2010-01", { "S-NPP": 0, "NOAA-20": 0, "NOAA-21": 0 }, cover, {}).value).toBeNull();
  });
});

describe("period classes", () => {
  it("labels observed and estimated periods", () => {
    expect(periodClass("2001-06")).toBe("terra-only-estimated");
    expect(periodClass("2002-07")).toBe("modis-observed");
    expect(periodClass("2015-03")).toBe("modis-observed");
    expect(periodClass("2022-01")).toBe("viirs-estimated");
  });
});

describe("overpass combination", () => {
  it("removes day+night double counting with the training overlap factor", () => {
    expect(combineOverpass(60, 40, 0.9)).toBeCloseTo(90);
  });
});

describe("validation metrics", () => {
  it("computes MAE, RMSE, bias and correlation", () => {
    const r = metrics([1, 2, 3, 4], [1, 2, 3, 5]);
    expect(r.mae).toBeCloseTo(0.25);
    expect(r.rmse).toBeCloseTo(0.5);
    expect(r.bias).toBeCloseTo(0.25);
    expect(r.r).toBeGreaterThan(0.95);
    expect(r.n).toBe(4);
  });
});

describe("v2 additions", () => {
  it("selects quantile mapping only when it beats the stratified ratio out of sample", async () => {
    const { selectMethod } = await import("./harmonize");
    expect(selectMethod({ stratified: 490, qm: 871 })).toBe("stratified");
    expect(selectMethod({ stratified: 74, qm: 54 })).toBe("qm");
    expect(selectMethod({ stratified: 50, qm: 50 })).toBe("stratified");
    expect(selectMethod({ stratified: 50, qm: NaN })).toBe("stratified");
  });

  it("builds multiplicative intervals from held-out residual ratios with leave-one-year-out coverage", async () => {
    const { residualIntervals } = await import("./harmonize");
    const rows = [];
    for (let y = 2012; y < 2022; y++) for (let i = 0; i < 12; i++) rows.push({ year: y, obs: 100 * (0.9 + 0.2 * ((i * 7 + y) % 11) / 10), pred: 100 });
    const r = residualIntervals(rows, 0.9);
    expect(r.lo).toBeGreaterThanOrEqual(0.9);
    expect(r.hi).toBeLessThanOrEqual(1.1);
    expect(r.lo).toBeLessThan(r.hi);
    expect(r.coverage).toBeGreaterThan(0.7);
    expect(r.n).toBe(120);
  });

  it("maps a partial month at its full-month run rate", async () => {
    const { qmEstimate, quantileMapFit } = await import("./harmonize");
    const qm = quantileMapFit([100, 200, 300], [50, 160, 300]);
    expect(qmEstimate(qm, 200)).toBeCloseTo(160);
    // 10 of 30 days observed with x = 100 -> run rate 300 -> 300, scaled back by 1/3
    expect(qmEstimate(qm, 100, 3)).toBeCloseTo(100);
  });
});
