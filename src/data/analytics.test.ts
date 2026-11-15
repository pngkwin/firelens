import { describe, expect, it } from "vitest";
import { parseCSV } from "./parse";
import {
  filterRecords,
  aggregate,
  buildBins,
  validateBounds,
  withAvailability,
} from "./analytics";
import { emptyFilters, type Dataset } from "./types";
import { addDataset } from "./repository";
const header =
  "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type";
const modis = "31,-100,310,1,1,2024-02-29,38,Terra,MODIS,87,61.03,290,7.5,N,0";
const viirs = "32,-99,320,.4,.5,2024-03-01,1230,SNPP,SNPP,n,2,280,2,D,0";
describe("FIRMS normalization and validation", () => {
  it("supports actual MODIS and archive SNPP schemas, preserves source confidence and thermal fields", () => {
    const { records } = parseCSV(`${header}\n${modis}\n${viirs}`, "test");
    expect(records[0]).toMatchObject({
      sensor: "MODIS",
      satellite: "Terra",
      time: "0038",
      confidence: "87",
      version: "61.03",
      frp: 7.5,
    });
    expect(new Date(records[0].timestamp).toISOString()).toBe(
      "2024-02-29T00:38:00.000Z",
    );
    expect(records[1]).toMatchObject({
      sensor: "VIIRS",
      satellite: "S-NPP",
      confidence: "n",
    });
    expect(records[1].thermal.bright_t31).toBe(280);
  });
  it("supports VIIRS NRT column names and missing optional fields", () => {
    const parsed = parseCSV(
      "latitude,longitude,acq_date,acq_time,satellite,bright_ti4\n1,2,2023-07-12,3,N,310",
      "test",
    );
    expect(parsed.records[0]).toMatchObject({
      sensor: "VIIRS",
      time: "0003",
      satellite: "S-NPP",
      version: "Not supplied",
    });
  });
  it("rejects malformed calendar dates, clocks, coordinates, mismatched platforms, and malformed rows", () => {
    const bad = [
      modis.replace("2024-02-29", "2023-02-29"),
      modis.replace(",38,", ",2460,"),
      modis.replace("31,-100", "91,-100"),
      modis.replace("Terra,MODIS", "Terra,VIIRS"),
      modis + ",extra",
    ];
    const result = parseCSV(`${header}\n${modis}\n${bad.join("\n")}`, "test");
    expect(result.rejected).toBe(5);
    expect(result.records).toHaveLength(1);
    expect(result.warnings).toHaveLength(5);
  });
  it("rejects non-FIRMS files, empty files, and all-invalid imports", () => {
    expect(() => parseCSV("name,value\na,2", "test")).toThrow(
      "Missing required",
    );
    expect(() => parseCSV(header, "test")).toThrow("no data rows");
    expect(() =>
      parseCSV(`${header}\n${modis.replace("31,-100", "bad,-100")}`, "test"),
    ).toThrow("No valid");
  });
  it("deduplicates exact observations within and across files", () => {
    const result = parseCSV(`${header}\n${modis}\n${modis}`, "a");
    expect(result.duplicates).toBe(1);
    const d = {
      id: "a",
      name: "a.csv",
      hash: "hash",
      source: "test",
      importedAt: "",
      ...result,
      sensors: ["MODIS"],
      satellites: ["Terra"],
      versions: ["61.03"],
      start: "2024-02-29",
      end: "2024-02-29",
    } as Dataset;
    expect(() => addDataset([d], d)).toThrow("already loaded");
    expect(() => addDataset([d], { ...d, id: "b", hash: "other" })).toThrow(
      "already loaded",
    );
  });
});
describe("shared spatial and temporal analysis", () => {
  it("distinguishes unavailable sensor periods from zero matching records", () => {
    const bins = buildBins([], "2024-01-01", "2024-12-31", "month");
    const extents = {
      MODIS: { start: "2024-01-03", end: "2024-01-28" },
      VIIRS: { start: "2024-12-01", end: "2024-12-31" },
    };
    const values = withAvailability(bins, extents);
    expect(values[0]).toEqual({ period: "2024-01", MODIS: 0, VIIRS: null });
    expect(values[11]).toEqual({ period: "2024-12", MODIS: null, VIIRS: 0 });
    expect(
      withAvailability(
        buildBins([], "2023-01-01", "2023-12-31", "month"),
        extents,
      ).every((b) => b.MODIS === null && b.VIIRS === null),
    ).toBe(true);
    expect(
      withAvailability(bins, { MODIS: null, VIIRS: null }).every(
        (b) => b.MODIS === null && b.VIIRS === null,
      ),
    ).toBe(true);
  });
  const records = parseCSV(`${header}\n${modis}\n${viirs}`, "test").records;
  it("shares UTC date, sensor, bounds and month filtering", () => {
    expect(
      filterRecords(records, { ...emptyFilters, sensor: "MODIS" }),
    ).toHaveLength(1);
    expect(
      filterRecords(records, {
        ...emptyFilters,
        start: "2024-03-01",
        end: "2024-03-01",
      }),
    ).toEqual([records[1]]);
    expect(
      filterRecords(records, {
        ...emptyFilters,
        bounds: { west: -101, east: -99.5, south: 30, north: 33 },
      }),
    ).toEqual([records[0]]);
    expect(
      filterRecords(records, { ...emptyFilters, month: "2024-02" }),
    ).toEqual([records[0]]);
    expect(
      filterRecords(records, { ...emptyFilters, month: "2024-02" }, false),
    ).toHaveLength(2);
  });
  it("keeps separate counts and aligned empty time bins", () => {
    expect(aggregate(records)).toEqual([
      { period: "2024-02", MODIS: 1, VIIRS: 0 },
      { period: "2024-03", MODIS: 0, VIIRS: 1 },
    ]);
    expect(
      buildBins(records, "2024-01-01", "2024-03-31", "month"),
    ).toHaveLength(3);
    expect(buildBins(records, "2024-01-01", "2024-03-31", "month")[0]).toEqual({
      period: "2024-01",
      MODIS: 0,
      VIIRS: 0,
    });
    expect(aggregate(records, "year")).toEqual([
      { period: "2024", MODIS: 1, VIIRS: 1 },
    ]);
  });
  it("handles antimeridian bounds and invalid regions", () => {
    const r = { ...records[0], longitude: 179 };
    expect(
      filterRecords([r], {
        ...emptyFilters,
        bounds: { west: 170, east: -170, south: 0, north: 50 },
      }),
    ).toHaveLength(1);
    expect(
      validateBounds({ west: 0, east: 1, south: 5, north: 2 }),
    ).toBeTruthy();
  });
});
