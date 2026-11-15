import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseCSV } from "./parse";
import { filterRecords, aggregate } from "./analytics";
import { emptyFilters } from "./types";
const viirsPath = "public/data/demo/v1/fire_archive_SV-C2_850215.csv.gz";
const modisPath = "public/data/demo/v1/fire_archive_M-C61_850214.csv.gz";
describe("authentic user-supplied historical archives", () => {
  it("validates exact counts, identities, dates, bounds, and consistent aggregations", () => {
    const v = parseCSV(
      gunzipSync(readFileSync(viirsPath)).toString("utf8"),
      "v",
    );
    const m = parseCSV(
      gunzipSync(readFileSync(modisPath)).toString("utf8"),
      "m",
    );
    expect(v.records).toHaveLength(47364);
    expect(m.records).toHaveLength(6827);
    expect(v.rejected + m.rejected + v.duplicates + m.duplicates).toBe(0);
    expect([...new Set(m.records.map((r) => r.satellite))].sort()).toEqual([
      "Aqua",
      "Terra",
    ]);
    expect([...new Set(v.records.map((r) => r.satellite))]).toEqual(["S-NPP"]);
    for (const records of [v.records, m.records]) {
      const dates = records.map((r) => r.date).sort();
      expect(dates[0]).toBe("2024-01-01");
      expect(dates.at(-1)).toBe("2024-12-31");
    }
    const records = [...v.records, ...m.records];
    expect(
      filterRecords(records, { ...emptyFilters, sensor: "MODIS" }),
    ).toHaveLength(6827);
    expect(
      filterRecords(records, { ...emptyFilters, sensor: "VIIRS" }),
    ).toHaveLength(47364);
    for (const sensor of ["MODIS", "VIIRS"] as const) {
      const bins = aggregate(records);
      const filtered = records.filter((r) => r.sensor === sensor);
      expect(bins.reduce((sum, b) => sum + b[sensor], 0)).toBe(filtered.length);
      for (const b of bins)
        expect(
          filterRecords(records, { ...emptyFilters, sensor, month: b.period }),
        ).toHaveLength(b[sensor]);
    }
    const area = { west: -101, east: -99, south: 30, north: 33 };
    const subset = filterRecords(records, {
      ...emptyFilters,
      bounds: area,
      month: "2024-06",
    });
    expect(
      subset.every(
        (r) =>
          r.date.startsWith("2024-06") &&
          r.longitude >= -101 &&
          r.longitude <= -99 &&
          r.latitude >= 30 &&
          r.latitude <= 33,
      ),
    ).toBe(true);
  });
});
