import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { latLngToCell, cellToParent, compactCells, gridDisk, cellToChildren } from "h3-js";
import {
  makeCompactClip, planRange, parseFirmsCsv, aggregateDays, parseExportParams, exportRow, toCsv, redact, txCost,
  EXPORT_COLUMNS, type RegionData, type SourceConfig,
} from "./nrtCore";

const sources: SourceConfig[] = [
  { id: "MODIS_SP", sensor: "MODIS", kind: "SP" },
  { id: "MODIS_NRT", sensor: "MODIS", kind: "NRT", after: "MODIS_SP" },
  { id: "VIIRS_SNPP_SP", sensor: "VIIRS", kind: "SP" },
  { id: "VIIRS_SNPP_NRT", sensor: "VIIRS", kind: "NRT", after: "VIIRS_SNPP_SP", endOfProduction: "2026-11-02" },
  { id: "VIIRS_NOAA20_NRT", sensor: "VIIRS", kind: "NRT" },
];
const availability = {
  MODIS_SP: { min: "2000-11-01", max: "2026-08-31" },
  MODIS_NRT: { min: "2026-09-01", max: "2026-11-15" },
  VIIRS_SNPP_SP: { min: "2012-01-20", max: "2026-07-31" },
  VIIRS_SNPP_NRT: { min: "2026-08-01", max: "2026-11-02" },
  VIIRS_NOAA20_NRT: { min: "2026-08-01", max: "2026-11-15" },
};
const boxes = [{ id: "b", bbox: [-120, 30, -110, 40] as [number, number, number, number] }];

describe("makeCompactClip", () => {
  it("accepts exactly the res-8 cells whose res-7 parent is in the region", () => {
    const centre = latLngToCell(34, -118, 7);
    const region7 = gridDisk(centre, 3); // 37 res-7 cells
    const compact = compactCells(region7);
    const inside = makeCompactClip(compact, 7);
    const ring = gridDisk(centre, 5).filter((c) => !region7.includes(c));
    for (const c of region7) for (const child of cellToChildren(c, 8)) expect(inside(child)).toBe(true);
    for (const c of ring) for (const child of cellToChildren(c, 8)) expect(inside(child)).toBe(false);
    // Compaction to a coarser ancestor still covers all descendants.
    const coarse = cellToParent(centre, 5);
    expect(cellToChildren(coarse, 8).every(makeCompactClip([coarse], 7))).toBe(true);
  });
});

describe("planRange", () => {
  it("uses NRT only after SP ends, stops S-NPP at end of production, clips to the range", () => {
    const jobs = planRange({ sources, availability, boxes, from: "2026-10-30", to: "2026-11-05" });
    const bySource = Object.groupBy(jobs, (j) => j.source);
    expect(Object.keys(bySource).sort()).toEqual(["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT"]);
    expect(bySource.MODIS_NRT!.map((j) => [j.date, j.days])).toEqual([["2026-10-30", 5], ["2026-11-04", 2]]);
    expect(bySource.VIIRS_SNPP_NRT!.map((j) => [j.date, j.days])).toEqual([["2026-10-30", 4]]);
    expect(txCost(jobs)).toBe(2 * (7 + 4 + 7));
  });
  it("chooses SP for archive dates and filters sensor families", () => {
    const jobs = planRange({ sources, availability, boxes, from: "2015-06-01", to: "2015-06-03", sensors: ["MODIS"] });
    expect(jobs).toEqual([{ source: "MODIS_SP", box: "b", bbox: boxes[0].bbox, date: "2015-06-01", days: 3 }]);
  });
  it("returns nothing for a range with no available source", () => {
    expect(planRange({ sources, availability, boxes, from: "1999-01-01", to: "1999-01-02" })).toEqual([]);
  });
});

describe("parseFirmsCsv", () => {
  it("rejects non-table responses such as key errors", () => {
    expect(() => parseFirmsCsv("Invalid MAP_KEY.")).toThrow(/Unexpected FIRMS response/);
  });
  it("parses rows", () => {
    const t = parseFirmsCsv("latitude,longitude,acq_date,satellite,daynight\n1,2,2026-11-01,N20,D\n");
    expect(t.rows).toEqual([["1", "2", "2026-11-01", "N20", "D"]]);
  });
});

describe("aggregateDays", () => {
  const c7 = latLngToCell(34, -118, 7);
  const region: RegionData = { id: "t", name: "t", boxes, clip: { res: 7, cells: 1, compact: [c7] }, staticCells: [], bundleEnd: "2026-11-01" };
  const header = ["latitude", "longitude", "acq_date", "satellite", "daynight", "frp"];
  const lat = 34, lon = -118;
  it("unions sensors per cell-day, clips the region and emits every day in range", () => {
    const out = aggregateDays({
      region, from: "2026-11-02", to: "2026-11-04", tables: [
        { source: "VIIRS_NOAA20_NRT", header, rows: [[`${lat}`, `${lon}`, "2026-11-02", "N20", "D", "5"], [`${lat}`, `${lon}`, "2026-11-02", "N20", "D", "1"], ["45", "-100", "2026-11-02", "N20", "D", "9"]] },
        { source: "MODIS_NRT", header, rows: [[`${lat}`, `${lon}`, "2026-11-02", "Aqua", "D", "7"], [`${lat}`, `${lon}`, "2026-11-03", "Terra", "N", ""]] },
      ],
    });
    expect(out.days.map((d) => d.day)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    const [d2, d3, d4] = out.days;
    expect(d2.fineCellDays).toBe(1);
    expect(d2.total[4]).toEqual([2 | 8, 1]); // one cell-day seen by Aqua and NOAA-20
    expect(d2.total[5]).toEqual([0, 1, 0, 2, 0]);
    expect(d2.total[6]).toEqual([0, 7, 0, 6, 0]);
    expect(d3.total[3]).toEqual([1, 1]); // night, Terra
    expect(d4.partition.rows).toEqual([]);
    expect(d4.total[4]).toEqual([]);
    expect(out.stats).toMatchObject({ accepted: 4, outsideRegion: 1, detectionsBySource: { VIIRS_NOAA20_NRT: 2, MODIS_NRT: 2 } });
  });
  it("applies the static-source mask", () => {
    const out = aggregateDays({ region: { ...region, staticCells: [latLngToCell(lat, lon, 8)] }, from: "2026-11-02", to: "2026-11-02", tables: [{ source: "MODIS_NRT", header, rows: [[`${lat}`, `${lon}`, "2026-11-02", "Aqua", "D", "7"]] }] });
    expect(out.stats.excludedStatic).toBe(1);
    expect(out.days[0].total[4]).toEqual([]);
  });
});

// Equivalence with the published bundle: aggregating the raw NRT API windows
// for one day here must reproduce public/data/v2/us exactly.
const ROOT = resolve(import.meta.dirname, "../..");
const RAW = join(ROOT, "data/raw/firms-api/us");
const REGION_FILE = join(ROOT, "convex/regionData/us.json");
describe.skipIf(!existsSync(RAW) || !existsSync(REGION_FILE))("aggregateDays vs published v2 bundle (US)", () => {
  it("reproduces the region total and res-5 cells for 2026-11-12", () => {
    const day = "2026-11-12";
    const region = JSON.parse(readFileSync(REGION_FILE, "utf8")) as RegionData;
    const tables = [];
    for (const source of ["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"])
      for (const box of region.boxes) {
        const dir = join(RAW, source, box.id, "2026");
        for (const f of existsSync(dir) ? readdirSync(dir) : []) {
          const [start, n] = f.replace(".csv.gz", "").split("_");
          const end = new Date(Date.parse(`${start}T00:00:00Z`) + (+n - 1) * 86_400_000).toISOString().slice(0, 10);
          if (start <= day && day <= end) tables.push({ source, ...parseFirmsCsv(gunzipSync(readFileSync(join(dir, f))).toString()) });
        }
      }
    expect(tables.length).toBe(12);
    const { days } = aggregateDays({ region, from: day, to: day, tables });
    const pub = JSON.parse(gunzipSync(readFileSync(join(ROOT, "public/data/v2/us/region-daily.json.gz"))).toString());
    const pubTotal = pub.rows[pub.periods.indexOf(day)];
    expect(days[0].total.slice(2)).toEqual(pubTotal.slice(2));
    // Every res-5 cell row matches the published daily shards.
    const shardRows = new Map<string, unknown>();
    for (const shard of readdirSync(join(ROOT, "public/data/v2/us/daily"))) {
      if (!existsSync(join(ROOT, "public/data/v2/us/daily", shard, "2026.json.gz"))) continue;
      const p = JSON.parse(gunzipSync(readFileSync(join(ROOT, "public/data/v2/us/daily", shard, "2026.json.gz"))).toString());
      const pi = p.periods.indexOf(day);
      for (const r of p.rows) if (r[1] === pi) shardRows.set(p.cells[r[0]], r.slice(2));
    }
    expect(days[0].partition.cells.length).toBe(shardRows.size);
    for (const [i, cell] of days[0].partition.cells.entries()) expect(days[0].partition.rows[i].slice(2)).toEqual(shardRows.get(cell));
  });
});

describe("parseExportParams", () => {
  const q = (s: string) => new URLSearchParams(s);
  const today = "2026-11-15";
  it("accepts a valid request and defaults sensors and end", () => {
    expect(parseExportParams(q("bbox=-120,30,-110,40&start=2026-11-01"), today)).toEqual({ ok: true, params: { bbox: [-120, 30, -110, 40], start: "2026-11-01", end: "2026-11-01", sensors: ["MODIS", "VIIRS"] } });
  });
  it.each([
    ["start=2026-11-01", /bbox/],
    ["bbox=1,2,3&start=2026-11-01", /four numbers/],
    ["bbox=10,0,5,1&start=2026-11-01", /west < east/],
    ["bbox=-120,30,-110,40&start=2026-02-30", /YYYY-MM-DD/],
    ["bbox=-120,30,-110,40&start=2026-11-05&end=2026-11-01", /after end/],
    ["bbox=-120,30,-110,40&start=2026-10-01&end=2026-11-02", /31 days/],
    ["bbox=-120,30,-110,40&start=2026-11-16", /today/],
    ["bbox=-120,30,-110,40&start=1999-01-01", /2000-11-01/],
    ["bbox=-120,30,-110,40&start=2026-11-01&sensors=goes", /sensors/],
  ])("rejects %s", (s, msg) => {
    const r = parseExportParams(q(s), today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});

describe("export rows", () => {
  it("maps MODIS and VIIRS schemas onto common columns and quotes CSV", () => {
    const vh = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time", "satellite", "instrument", "confidence", "version", "bright_ti5", "frp", "daynight"];
    const v = exportRow("VIIRS_NOAA20_NRT", vh, ["46.5", "-84.3", "310.14", "0.41", "0.45", "2026-11-14", "716", "N20", "VIIRS", "n", "2.0NRT", "271.91", "2.03", "N"]);
    expect(v).toHaveLength(EXPORT_COLUMNS.length);
    expect(v.slice(0, 3)).toEqual(["VIIRS_NOAA20_NRT", "NOAA-20", "VIIRS"]);
    expect(v[EXPORT_COLUMNS.indexOf("bright_mir_k")]).toBe("310.14");
    expect(v[EXPORT_COLUMNS.indexOf("bright_tir_k")]).toBe("271.91");
    const mh = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time", "satellite", "instrument", "confidence", "version", "bright_t31", "frp", "daynight", "type"];
    const m = exportRow("MODIS_SP", mh, ["31.1", "-85.3", "301.48", "1", "1", "2015-11-10", "156", "Terra", "MODIS", "41", "6.1", "283.63", "6.93", "N", "0"]);
    expect(m[1]).toBe("Terra");
    expect(m[EXPORT_COLUMNS.indexOf("type")]).toBe("0");
    expect(toCsv([["a,b", 'q"x']]).split("\n")[1]).toBe('"a,b","q""x"');
  });
  it("redacts the key from any text", () => {
    expect(redact("GET /api/area/csv/abc123/MODIS", "abc123")).toBe("GET /api/area/csv/<MAP_KEY>/MODIS");
  });
});

describe("streaming CSV helpers", () => {
  const text = "latitude,longitude,acq_date,satellite,daynight,frp\r\n1,2,2026-11-01,N20,D,3\r\n4,5,2026-11-01,Aqua,N,\r\n";
  it("counts and splits lines, tolerating CRLF and a trailing newline", async () => {
    const { countLines, csvLines, exportCsvText, CSV_HEADER } = await import("./nrtCore");
    expect(countLines(text)).toBe(2);
    expect(countLines("latitude,longitude,acq_date,satellite,daynight\n")).toBe(0);
    expect([...csvLines(text)]).toEqual([["1", "2", "2026-11-01", "N20", "D", "3"], ["4", "5", "2026-11-01", "Aqua", "N", ""]]);
    const csv = exportCsvText("VIIRS_NOAA20_NRT", text);
    expect(csv.split("\n").filter(Boolean)).toHaveLength(2);
    expect(csv.startsWith("VIIRS_NOAA20_NRT,NOAA-20,VIIRS,1,2,2026-11-01,")).toBe(true);
    expect(CSV_HEADER.split(",")[0]).toBe("source");
  });
  it("incremental aggregation equals batch aggregation", async () => {
    const { dayAggregator, aggregateDays, parseFirmsCsv } = await import("./nrtCore");
    const c7 = latLngToCell(1, 2, 7);
    const region = { id: "t", name: "t", boxes, clip: { res: 7, cells: 1, compact: [c7] }, staticCells: [], bundleEnd: "2026-10-31" };
    const inc = dayAggregator(region, "2026-11-01", "2026-11-01");
    inc.addCsv("X", text);
    expect(inc.finish()).toEqual(aggregateDays({ region, from: "2026-11-01", to: "2026-11-01", tables: [{ source: "X", ...parseFirmsCsv(text) }] }));
  });
});

describe("pullRange", () => {
  it("covers the gap since the bundle, the refresh window, and nothing the bundle covers", async () => {
    const { pullRange } = await import("./nrtCore");
    const base = { bundleEnd: "2026-11-14", refreshDays: 3, maxDays: 30 };
    expect(pullRange({ ...base, latest: null, today: "2026-11-15" })).toEqual({ from: "2026-11-15", to: "2026-11-15" });
    expect(pullRange({ ...base, latest: "2026-11-20", today: "2026-11-21" })).toEqual({ from: "2026-11-19", to: "2026-11-21" });
    expect(pullRange({ ...base, latest: "2026-11-16", today: "2026-11-25" })).toEqual({ from: "2026-11-17", to: "2026-11-25" });
    expect(pullRange({ ...base, latest: null, today: "2027-02-01" })).toEqual({ from: "2027-01-03", to: "2027-02-01" });
    expect(pullRange({ ...base, latest: null, today: "2026-11-14" })).toBeNull();
  });
});
