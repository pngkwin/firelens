import { describe, it, expect } from "vitest";
import {
  historicalBaseline,
  quantile,
  type HistoricalValue,
} from "./anomalies";
const series = (values: (number | null)[]): HistoricalValue[] =>
  values.map((count, i) => ({
    month: `${2020 + i}-02`,
    count,
    eligible: true,
    seriesKey: "MODIS/Terra/r5/cell/count/v1",
  }));
describe("explicit historical comparability", () => {
  it("requires prior years of the same month, excluding target and future", () => {
    const result = historicalBaseline(series([2, 4, 6, 10, 999]), "2023-02");
    expect(result).toMatchObject({
      median: 4,
      q25: 3,
      q75: 5,
      relativeDeviation: 1.5,
      years: [2020, 2021, 2022],
      baselinePeriod: "2020–2022",
    });
    expect(historicalBaseline(series([2, 4, 6]), "2023-03").status).toBe(
      "insufficient-history",
    );
  });
  it("does not manufacture coverage, sensor equivalence, or relative deviations from zero", () => {
    expect(
      historicalBaseline(series([0, 0, 0, 5]), "2023-02").relativeDeviation,
    ).toBeNull();
    expect(historicalBaseline(series([2, null, 6, 10]), "2023-02").status).toBe(
      "insufficient-history",
    );
    expect(
      historicalBaseline(
        series([2, 4, 6, 10]).map((v) => ({ ...v, eligible: false })),
        "2023-02",
      ).status,
    ).toBe("insufficient-history");
    expect(() =>
      historicalBaseline(
        [
          ...series([1]),
          { ...series([2])[0], month: "2021-02", seriesKey: "VIIRS" },
        ],
        "2023-02",
      ),
    ).toThrow(/Incompatible/);
    expect(() =>
      historicalBaseline([...series([1]), ...series([1])], "2023-02"),
    ).toThrow(/Duplicate/);
  });
  it("reports insufficient history for single-year inputs, and handles empty inputs", () => {
    expect(
      historicalBaseline(
        [
          {
            month: "2024-01",
            count: 6827,
            eligible: false,
            seriesKey: "MODIS",
          },
        ],
        "2024-01",
      ).status,
    ).toBe("insufficient-history");
    expect(historicalBaseline([], "2025-01").median).toBeNull();
    expect(quantile([], 0.5)).toBeNull();
    expect(() => quantile([1], 2)).toThrow();
  });
});
