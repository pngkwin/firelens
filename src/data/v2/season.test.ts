// Fire-season evolution statistics and the documented-incident context layer.
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createBundle } from "./bundle";
import { addMonthly, harmonize, regionReferenceX, type MonthResult, type MonthZones } from "./series";
import { analyzeSeason, circDiff, circular, compareSeasons, monthPosition, months80, peak3, seasonYears, type SeasonYear } from "./season";
import { INCIDENTS } from "./incidents";
import { CASES } from "./casebook";
import { inPolys, type Polys } from "./aoi";

describe("season statistics", () => {
  it("circular centre and concentration", () => {
    const one = Array(12).fill(0); one[2] = 1; // all in March
    expect(circular(one).centroid).toBeCloseTo(2.5, 10);
    expect(circular(one).r).toBeCloseTo(1, 10);
    expect(circular(Array(12).fill(1 / 12)).r).toBeCloseTo(0, 10);
    const decJan = Array(12).fill(0); decJan[11] = 0.5; decJan[0] = 0.5; // wraps the new year
    expect(Math.min(circular(decJan).centroid, 12 - circular(decJan).centroid)).toBeCloseTo(0, 10);
    expect(circDiff(11.5, 0.5)).toBeCloseTo(1, 10);
    expect(circDiff(0.5, 11.5)).toBeCloseTo(-1, 10);
    expect(monthPosition(2.5)).toBe("mid Mar");
  });
  it("busiest three months wrap the new year; months holding 80%", () => {
    const s = [0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.4];
    expect(peak3(s)).toEqual({ start: 10, share: 1 });
    expect(months80(s)).toBe(3);
    expect(months80(Array(12).fill(1 / 12))).toBe(10);
  });
  const year = (y: number, peak: number): SeasonYear => {
    const shares = Array(12).fill(0.02); shares[peak] = 0.78;
    const c = circular(shares);
    return { year: y, total: 100, shares, centroid: c.centroid, r: c.r, peak3: peak3(shares), m80: months80(shares), estimatedMonths: 0 };
  };
  it("permutation test detects a clear shift and not a null one (exact enumeration)", () => {
    const A = [2003, 2004, 2005, 2006, 2007].map((y) => year(y, 7)), B = [2013, 2014, 2015, 2016, 2017].map((y) => year(y, 9));
    const t = compareSeasons(A, B)!;
    const c = t.find((x) => x.stat.id === "centroid")!;
    expect(c.exact).toBe(true);
    expect(c.permutations).toBe(252); // C(10,5)
    expect(c.diff).toBeCloseTo(2, 1);
    expect(c.p).toBeCloseTo(2 / 252, 10); // only the observed split and its mirror are as extreme
    const same = compareSeasons(A, [2013, 2014, 2015, 2016, 2017].map((y) => year(y, 7)))!;
    for (const x of same) expect(x.p).toBe(1);
    expect(compareSeasons(A.slice(0, 3), B)).toBeNull(); // fewer than 4 years
  });
  it("Holm adjustment is monotone and never below the raw p", () => {
    const A = [2003, 2004, 2005, 2006, 2007].map((y) => year(y, 7)), B = [2013, 2014, 2015, 2016, 2017].map((y, i) => year(y, i % 2 ? 7 : 8));
    for (const x of compareSeasons(A, B)!) { expect(x.pHolm).toBeGreaterThanOrEqual(x.p); expect(x.pHolm).toBeLessThanOrEqual(1); }
  });
});

const ROOT = resolve(import.meta.dirname, "../../..");
const ff = (async (u: string | URL | Request) => { const p = join(ROOT, "public", String(u)); return existsSync(p) ? new Response(readFileSync(p) as Uint8Array<ArrayBuffer>) : new Response("x", { status: 404 }); }) as typeof fetch;
async function load(region: string, preset?: string): Promise<MonthResult[]> {
  const b = createBundle(region, { fetchImpl: ff });
  const [m, { cal }, zm] = await Promise.all([b.manifest(), b.calibration(), b.partition("zone-monthly.json.gz")]);
  const reg: MonthZones = new Map(); addMonthly(reg, zm, null);
  let mz = reg;
  if (preset) { mz = new Map(); addMonthly(mz, await b.partition(`aoi/${preset}.json.gz`), null); for (const k of reg.keys()) if (!mz.has(k)) mz.set(k, new Map()); }
  const o = { dataEnd: m.planEnd, planEnd: m.planEnd };
  return harmonize(mz, cal, { ...o, regionX: preset ? regionReferenceX(reg, cal, o) : undefined, aoiNoise: !!preset });
}

describe("season evolution on the published bundle", () => {
  const data = new Map<string, MonthResult[]>();
  beforeAll(async () => { data.set("tx", await load("us", "us-48")); data.set("ca", await load("us", "us-06")); data.set("iberia", await load("iberia")); }, 120_000);

  it("uses only complete years without material outage, normalized to annual shares", () => {
    const { years, excluded } = seasonYears(data.get("tx")!);
    expect(years.every((y) => Math.abs(y.shares.reduce((a, b) => a + b, 0) - 1) < 1e-9)).toBe(true);
    expect(years.map((y) => y.year)).not.toContain(2026); // incomplete year
    expect(excluded.find((e) => e.year === 2026)?.reason).toBe("incomplete year");
    expect(excluded.find((e) => e.year === 2016)?.reason).toMatch(/satellite outage/);
  });
  it("Texas: March peak in both observed-MODIS periods, no significant change, VIIRS check present", () => {
    const s = analyzeSeason(data.get("tx")!);
    expect(s.profiles.map((p) => p.period.label)).toEqual(["2003–2012", "2013–2021", "2022–2025"]);
    expect(s.profiles[0].peakMonth).toBe(2);
    expect(s.profiles[1].peakMonth).toBe(2);
    expect(s.tests!.every((t) => t.exact && t.pHolm >= 0.05)).toBe(true);
    expect(s.sensor!.years.length).toBeGreaterThanOrEqual(5);
    expect(s.findings.join(" ")).toMatch(/No change in the seasonal centre/);
  });
  it("California: August peak; the concentration increase is not significant after correction", () => {
    const s = analyzeSeason(data.get("ca")!);
    expect(s.profiles[0].peakMonth).toBe(7);
    expect(s.profiles[1].peakMonth).toBe(7);
    const conc = s.tests!.find((t) => t.stat.id === "concentration")!;
    expect(conc.diff).toBeGreaterThan(0);
    expect(conc.pHolm).toBeGreaterThanOrEqual(0.05);
  });
  it("Iberia: August peak in every period", () => {
    const s = analyzeSeason(data.get("iberia")!);
    expect(s.profiles.map((p) => p.peakMonth)).toEqual([7, 7, 7]);
  });
});

describe("documented incidents", () => {
  const list = (JSON.parse(readFileSync(join(ROOT, "public/data/presets/us.json"), "utf8")) as { items: Array<{ id: string; polys: Polys }> }).items;
  it("every record is sourced, dated, linked to a case and inside its area", () => {
    const ids = new Set(CASES.map((c) => c.id));
    for (const i of INCIDENTS) {
      expect(i.source.length, i.id).toBeGreaterThan(0);
      for (const s of i.source) expect(s.url, i.id).toMatch(/^https:\/\//);
      expect(i.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (i.end) expect(i.end >= i.start).toBe(true);
      expect(ids.has(i.caseId), i.id).toBe(true);
      for (const m of i.months) expect(m).toMatch(/^\d{4}-\d{2}$/);
      expect(i.months[0] <= i.start.slice(0, 7) || i.months.includes(i.start.slice(0, 7))).toBe(true);
      if (i.location && i.preset) {
        const p = list.find((x) => x.id === i.preset)!;
        expect(inPolys(i.location[0], i.location[1], p.polys), i.id).toBe(true);
      }
    }
  });
  it("only CAL FIRE records carry point locations (published coordinates)", () => {
    for (const i of INCIDENTS) if (i.location) expect(i.source.some((s) => s.url.startsWith("https://www.fire.ca.gov/"))).toBe(true);
  });
});
