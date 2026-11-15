import { describe, it, expect } from "vitest";
import { parseState, serializeState, DEFAULT_STATE } from "./urlState";
import { filterPointsCsv, monthlyCsv, MONTHLY_COLUMNS } from "./exportsV2";
import type { MonthResult } from "./series";

describe("URL state", () => {
  it("round-trips a full view", () => {
    const s = { region: "iberia" as const, aoi: { kind: "circle" as const, center: [-8.2, 40.1] as [number, number], radiusKm: 50 }, from: "2012-01", to: "2026-11", scale: "raw-viirs" as const, focus: "2025-08" };
    const q = serializeState(s);
    expect(q).toBe("?r=iberia&aoi=circle:-8.2,40.1,50&from=2012-01&to=2026-11&scale=raw-viirs&focus=2025-08");
    expect(parseState(q)).toEqual({ state: s, errors: [] });
  });
  it("defaults missing values and reports invalid ones without throwing", () => {
    expect(parseState("")).toEqual({ state: DEFAULT_STATE, errors: [] });
    const r = parseState("?r=mars&from=2020-13&to=2019-01&scale=lol&aoi=bbox:1,2");
    expect(r.state.region).toBe("us");
    expect(r.state.scale).toBe("modis-eq");
    expect(r.errors).toHaveLength(4);
    const r2 = parseState("?from=2020-01&to=2019-01");
    expect(r2.state.from).toBeNull();
    expect(r2.errors[0]).toMatch(/after/);
  });
});

describe("exports", () => {
  const r: MonthResult = {
    month: "2024-08", cls: "viirs-estimated", method: "stratified", value: 1234.56, lo: 1100, hi: 1400, viirsLevel: 2500, viirsLevelEstimated: false,
    reference: "NOAA-20", viirsPlatform: "S-NPP", raw: { any: { M: 1000, Terra: 600, Aqua: 700, "S-NPP": 2400, "NOAA-20": 2500, "NOAA-21": 2450, V: 3000, ALL: 3100 }, day: {} as never, night: {} as never },
    det: [1, 2, 3, 4, 5], frp: [1.25, 2, 3, 4, 5], daysCovered: 31, daysInMonth: 31,
  };
  it("writes the harmonized monthly CSV with estimate labels and intervals", () => {
    const lines = monthlyCsv([r, { ...r, month: "2015-08", cls: "modis-observed", method: "observed", lo: 1000, hi: 1000 }]).trim().split("\n");
    expect(lines[0].split(",")).toEqual([...MONTHLY_COLUMNS]);
    const row = lines[1].split(",");
    const col = (k: string) => row[MONTHLY_COLUMNS.indexOf(k as never)];
    expect(col("modis_eq_source")).toMatch(/^ESTIMATED from VIIRS/);
    expect(col("method_version")).toBe("fcd-harmonize-v2");
    expect(col("modis_eq_fire_cell_days")).toBe("1234.6");
    expect(col("modis_eq_lo90")).toBe("1100.0");
    expect(col("raw_any_sensor")).toBe("3100");
    expect(col("frp_sum_mw_terra")).toBe("1.3");
    expect(lines[2].split(",")[MONTHLY_COLUMNS.indexOf("modis_eq_lo90")]).toBe("");
  });
  it("filters point CSV rows to the AOI", () => {
    const out = filterPointsCsv("source,latitude,longitude\nA,1,1\nB,5,5\n", (lon) => lon < 2);
    expect(out).toEqual({ csv: "source,latitude,longitude\nA,1,1\n", kept: 1, total: 2 });
    expect(() => filterPointsCsv("a,b\n1,2", () => true)).toThrow(/latitude/);
  });
});
