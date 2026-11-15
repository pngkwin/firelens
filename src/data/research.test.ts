import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import Papa from "papaparse";
import { parseCSV } from "./parse";
import { emptyFilters, type Dataset } from "./types";
import { filterRecords } from "./analytics";
import {
  activityRows,
  comparisonData,
  countScale,
  periodAvailability,
  recordWindows,
  studyDates,
} from "./research";
import { monthlyCSV, observationsCSV } from "./exports";
const manifest = JSON.parse(
  fs.readFileSync("public/data/demo/v1/manifest.json", "utf8"),
);
const datasets: Dataset[] = manifest.files.map(
  (
    file: { name: string; url: string; hash: string; source: string },
    index: number,
  ) => {
    const parsed = parseCSV(
      gunzipSync(fs.readFileSync("public" + file.url)).toString("utf8"),
      "bundle" + index,
    );
    return {
      ...file,
      id: "bundle" + index,
      ...parsed,
      sensors: [...new Set(parsed.records.map((r) => r.sensor))],
      satellites: [...new Set(parsed.records.map((r) => r.satellite))],
      versions: [...new Set(parsed.records.map((r) => r.version))],
      start: parsed.records.map((r) => r.date).sort()[0],
      end: parsed.records
        .map((r) => r.date)
        .sort()
        .at(-1),
      importedAt: "2026-11-15T00:00:00Z",
    } as Dataset;
  },
);
const records = datasets.flatMap((d) => d.records),
  windows = recordWindows(datasets),
  extent = { start: "2024-01-01", end: "2024-12-31" };
describe("real-data study analysis and exports", () => {
  it("treats adjacent inclusive date intervals as continuous and rejects invalid export ranges", () => {
    expect(
      periodAvailability("2024-01", extent, [
        { start: "2024-01-01", end: "2024-01-15" },
        { start: "2024-01-16", end: "2024-01-31" },
      ]),
    ).toBe("within-record-interval");
    expect(
      periodAvailability("2024-01", extent, [
        { start: "2024-01-02", end: "2024-01-31" },
      ]),
    ).toBe("partial-record-interval");
    expect(() =>
      monthlyCSV(
        records,
        datasets,
        { ...emptyFilters, start: "2025-01-01", end: "2024-01-01" },
        extent,
      ),
    ).toThrow("No valid monthly interval");
  });
  it("uses all verified archive records in separate paired streams", () => {
    const data = comparisonData(records, emptyFilters, windows, extent);
    expect(data.records.filter((r) => r.sensor === "MODIS")).toHaveLength(6827);
    expect(data.records.filter((r) => r.sensor === "VIIRS")).toHaveLength(
      47364,
    );
    expect(data.rows).toHaveLength(12);
    expect(data.rows.reduce((n, r) => n + (r.MODIS ?? 0), 0)).toBe(6827);
    expect(data.rows.reduce((n, r) => n + (r.VIIRS ?? 0), 0)).toBe(47364);
    expect(data.rows.find((r) => r.period === "2024-02")?.VIIRS).toBe(6744);
  });
  it("exports exactly the filtered observations, original fields and study/source metadata", () => {
    const filters = {
      ...emptyFilters,
      sensor: "MODIS" as const,
      month: "2024-06",
      bounds: { west: -101, east: -99, south: 30, north: 33 },
    };
    const focused = filterRecords(records, filters);
    const csv = Papa.parse<Record<string, string>>(
      observationsCSV(focused, datasets, filters, extent),
      { header: true, skipEmptyLines: true },
    );
    expect(csv.errors).toEqual([]);
    expect(csv.data).toHaveLength(focused.length);
    expect(focused.length).toBeGreaterThan(0);
    for (const [i, row] of csv.data.entries()) {
      expect(row.sensor).toBe("MODIS");
      expect(row.acq_date_utc).toBe(focused[i].date);
      expect(row.acq_time_utc).toBe(focused[i].time);
      expect(row.dataset_sha256).toBe(datasets[0].hash);
      expect(row.confidence_source_value).toBe(focused[i].confidence);
      expect(JSON.parse(row.study_filters).month).toBe("2024-06");
    }
    expect(
      new Set(
        csv.data.map((r) =>
          [
            r.sensor,
            r.platform,
            r.acq_date_utc,
            r.acq_time_utc,
            r.latitude,
            r.longitude,
          ].join("|"),
        ),
      ).size,
    ).toBe(focused.length);
  });
  it("exports aligned monthly counts, exclusions and unavailable periods without invented zeros", () => {
    const csv = Papa.parse<Record<string, string>>(
      monthlyCSV(records, datasets, emptyFilters, extent),
      { header: true, skipEmptyLines: true },
    );
    expect(csv.data).toHaveLength(12);
    expect(csv.data.reduce((n, r) => n + Number(r.MODIS_count), 0)).toBe(6827);
    expect(csv.data.reduce((n, r) => n + Number(r.VIIRS_count), 0)).toBe(47364);
    const filters = {
      ...emptyFilters,
      sensor: "MODIS" as const,
      start: "2023-01-01",
      end: "2023-02-28",
    };
    const outside = Papa.parse<Record<string, string>>(
      monthlyCSV([], datasets, filters, extent),
      { header: true, skipEmptyLines: true },
    );
    expect(outside.data).toHaveLength(2);
    expect(
      outside.data.every(
        (r) =>
          r.MODIS_count === "" &&
          r.VIIRS_count === "" &&
          r.MODIS_status.includes("outside record extent") &&
          r.VIIRS_status.includes("Excluded"),
      ),
    ).toBe(true);
  });
  it("identifies partial date intervals and gaps rather than asserting complete coverage", () => {
    expect(
      periodAvailability(
        "2024-02",
        { start: "2024-02-10", end: "2024-02-20" },
        windows.MODIS,
      ),
    ).toBe("partial-record-interval");
    expect(
      periodAvailability("2024-02", extent, [
        { start: "2024-02-12", end: "2024-02-20" },
      ]),
    ).toBe("partial-record-interval");
    expect(
      periodAvailability("2024-06", extent, [
        { start: "2024-01-01", end: "2024-01-31" },
        { start: "2024-12-01", end: "2024-12-31" },
      ]),
    ).toBe("outside-record-extent");
  });
  it("supports multi-decade date bins without fabricating historical observations", () => {
    const dates = { start: "2000-01-01", end: "2030-12-31" };
    const rows = activityRows(records, dates, windows);
    expect(rows).toHaveLength(372);
    expect(
      rows
        .filter((r) => !r.period.startsWith("2024"))
        .every((r) => r.MODIS === null && r.VIIRS === null),
    ).toBe(true);
    expect(
      rows
        .filter((r) => r.period.startsWith("2024"))
        .reduce((n, r) => n + (r.VIIRS ?? 0), 0),
    ).toBe(47364);
  });
  it("honors single-sensor filtering and selected-month scope in comparison and summary", () => {
    const filters = {
      ...emptyFilters,
      sensor: "VIIRS" as const,
      month: "2024-06",
    };
    const data = comparisonData(records, filters, windows, extent);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      period: "2024-06",
      MODIS: null,
      VIIRS: 3537,
    });
    expect(studyDates(filters, extent)).toEqual({
      start: "2024-06-01",
      end: "2024-06-30",
    });
    const filtered = filterRecords(records, filters);
    expect(
      Papa.parse(monthlyCSV(filtered, datasets, filters, extent), {
        header: true,
      }).data,
    ).toHaveLength(1);
  });
  it("builds meaningful non-overlapping integer count ranges", () => {
    for (const max of [1, 2, 5, 1438, 6744]) {
      const scale = countScale(max);
      expect(scale[0].low).toBe(1);
      expect(scale.at(-1)?.high).toBe(max);
      expect(
        scale.every(
          (r, i) =>
            r.low <= r.high && (i === 0 || r.low === scale[i - 1].high + 1),
        ),
      ).toBe(true);
    }
  });
});
