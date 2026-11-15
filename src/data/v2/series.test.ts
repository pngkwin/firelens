import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { latLngToCell, cellToParent } from "h3-js";
import { createBundle } from "./bundle";
import { addMonthly, addDaily, harmonize, harmonizeDays, regionReferenceX, type MonthZones, type DayVals } from "./series";
import { makeAoiTest } from "./aoi";
import type { V2Partition } from "./codec";

const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
const ROOT = resolve(import.meta.dirname, "../../..");
const fileFetch = (opts: { decompress?: boolean } = {}) =>
  (async (url: string | URL | Request) => {
    const p = join(ROOT, "public", String(url));
    if (!existsSync(p)) return new Response("missing", { status: 404 });
    let b: Uint8Array = readFileSync(p);
    if (opts.decompress && p.endsWith(".gz")) b = gunzipSync(b); // host with Content-Encoding: gzip
    return new Response(b as Uint8Array<ArrayBuffer>);
  }) as typeof fetch;

describe("bundle client", () => {
  it("verifies hashes for raw gzip and transparently decoded responses, and rejects tampering", async () => {
    for (const decompress of [false, true]) {
      const b = createBundle("iberia", { fetchImpl: fileFetch({ decompress }) });
      const p = await b.partition("region-monthly.json.gz");
      expect(p.kind).toBe("monthly");
      expect((await b.calibration()).cal.method).toBe("fcd-harmonize-v2");
    }
    const tampered = createBundle("iberia", {
      fetchImpl: (async (url: string) => {
        const r = await fileFetch()(url);
        if (!String(url).endsWith("region-monthly.json.gz")) return r;
        const b = new Uint8Array(await r.arrayBuffer());
        b[b.length - 10] ^= 1;
        return new Response(b);
      }) as typeof fetch,
    });
    await expect(tampered.partition("region-monthly.json.gz")).rejects.toThrow(/checksum/);
    // A stale cached copy (e.g. after a republish under the same path) is refetched once, bypassing the cache.
    const calls: Array<RequestCache | undefined> = [];
    const stale = createBundle("iberia", {
      fetchImpl: (async (url: string, init?: RequestInit) => {
        const r = await fileFetch()(url);
        if (!String(url).endsWith("region-monthly.json.gz")) return r;
        calls.push(init?.cache);
        const b = new Uint8Array(await r.arrayBuffer());
        if (init?.cache !== "reload") b[b.length - 10] ^= 1;
        return new Response(b);
      }) as typeof fetch,
    });
    expect((await stale.partition("region-monthly.json.gz")).kind).toBe("monthly");
    expect(calls).toEqual([undefined, "reload"]);
    await expect(createBundle("iberia", { fetchImpl: fileFetch() }).partition("monthly/nope.json.gz")).rejects.toThrow(/not listed/);
  });
});

describe.each(["us", "iberia"])("whole-region harmonization equals the fit (%s)", (region) => {
  it("reproduces calibration.regionSeries for every month", async () => {
    const b = createBundle(region, { fetchImpl: fileFetch() });
    const [m, { cal }, zm] = await Promise.all([b.manifest(), b.calibration(), b.partition("zone-monthly.json.gz")]);
    const months: MonthZones = new Map();
    addMonthly(months, zm, null);
    const res = harmonize(months, cal, { dataEnd: m.planEnd, planEnd: m.planEnd });
    expect(res).toHaveLength(Object.keys(cal.regionSeries).length);
    for (const r of res) {
      const want = cal.regionSeries[r.month];
      expect(r.cls).toBe(want.cls);
      if (want.value == null) expect(r.value).toBeNull();
      else {
        // Published coefficients are rounded (k to 6 decimals, interval bounds to 4).
        expect(rel(r.value!, want.value)).toBeLessThan(1e-4);
        expect(rel(r.lo!, want.lo!)).toBeLessThan(1e-4);
        expect(rel(r.hi!, want.hi!)).toBeLessThan(1e-4);
      }
      if (want.viirsLevel == null) expect(r.viirsLevel).toBeNull();
      else expect(rel(r.viirsLevel!, want.viirsLevel)).toBeLessThan(1e-4);
      expect(!r.viirsLevelEstimated).toBe(want.viirsObserved);
    }
  });
});

describe("AOI aggregation", () => {
  it("cell shards filtered to the full region equal zone-monthly; a sub-AOI is a strict subset", async () => {
    const b = createBundle("iberia", { fetchImpl: fileFetch() });
    const m = await b.manifest();
    const { cal } = await b.calibration();
    const full: MonthZones = new Map(), part: MonthZones = new Map(), zones: MonthZones = new Map();
    const madrid = makeAoiTest([[[[-4.5, 39.8], [-3, 39.8], [-3, 41], [-4.5, 41], [-4.5, 39.8]]]]);
    for (const f of m.files.filter((f) => f.path.startsWith("monthly/"))) {
      const p = await b.partition(f.path);
      addMonthly(full, p, null);
      addMonthly(part, p, madrid);
    }
    addMonthly(zones, await b.partition("zone-monthly.json.gz"), null);
    const opts = { dataEnd: m.planEnd, planEnd: m.planEnd };
    const a = harmonize(full, cal, opts), z = harmonize(zones, cal, opts);
    expect(a.map((r) => [r.month, r.raw.any.ALL, r.value?.toFixed(6)])).toEqual(z.map((r) => [r.month, r.raw.any.ALL, r.value?.toFixed(6)]));
    const regionX = regionReferenceX(zones, cal, opts);
    const sub = harmonize(part, cal, { ...opts, regionX, aoiNoise: true });
    const tot = (rs: typeof a) => rs.reduce((s, r) => s + r.raw.any.ALL, 0);
    expect(tot(sub)).toBeGreaterThan(0);
    expect(tot(sub)).toBeLessThan(tot(a));
    // quantile mapping (Iberia): AOI estimate = region estimate x AOI share of the VIIRS reference
    const r = sub.find((x) => x.month === "2025-08")!, R = z.find((x) => x.month === "2025-08")!;
    const x = regionX.get("2025-08")!;
    expect(r.method).toBe("qm");
    expect(r.value! / R.value!).toBeCloseTo((r.raw.day["S-NPP"] + r.raw.night["S-NPP"]) / x, 6);
    // Poisson widening for AOIs
    expect(r.lo!).toBeLessThan(r.value! * cal.interval90!.lo);
  });

  it("days sum to the monthly estimate (reference-sensor shape)", async () => {
    const b = createBundle("us", { fetchImpl: fileFetch() });
    const m = await b.manifest();
    const { cal } = await b.calibration();
    const months: MonthZones = new Map(), days: DayVals = new Map();
    addMonthly(months, await b.partition("zone-monthly.json.gz"), null);
    addDaily(days, await b.partition("region-daily.json.gz"), null);
    const monthly = harmonize(months, cal, { dataEnd: m.planEnd, planEnd: m.planEnd });
    const daily = harmonizeDays(days, monthly);
    for (const month of ["2001-08", "2015-08", "2024-08", "2026-11"]) {
      const want = monthly.find((r) => r.month === month)!;
      const got = daily.filter((d) => d.day.startsWith(month));
      expect(got.reduce((s, d) => s + (d.value ?? 0), 0)).toBeCloseTo(want.value!, 6);
      expect(got.reduce((s, d) => s + (d.viirsLevel ?? 0), 0)).toBeCloseTo(want.viirsLevel ?? 0, 6);
      expect(got.reduce((s, d) => s + d.raw.ALL, 0)).toBe(want.raw.any.ALL);
    }
  });
});

describe("live NRT days", () => {
  it("fold into the month by res-1 zone and extend VIIRS cover past the bundle end", async () => {
    const b = createBundle("us", { fetchImpl: fileFetch() });
    const m = await b.manifest();
    const { cal } = await b.calibration();
    const months: MonthZones = new Map();
    addMonthly(months, await b.partition("zone-monthly.json.gz"), null);
    const before = harmonize(months, cal, { dataEnd: m.planEnd, planEnd: m.planEnd }).at(-1)!;
    const cell = latLngToCell(37, -120, 5);
    const live: V2Partition = { v: 2, region: "us", kind: "daily", res: 5, shard: "region-nrt", periods: ["2026-11-15"], cells: [cell], rows: [[0, 0, [8, 10], [], [8, 10], [0, 0, 0, 12, 0], [0, 0, 0, 30, 0]]] };
    addMonthly(months, live, null);
    expect(months.get("2026-11")!.has(cellToParent(cell, 1))).toBe(true);
    const after = harmonize(months, cal, { dataEnd: "2026-11-15", planEnd: m.planEnd }).at(-1)!;
    expect(after.raw.any.ALL).toBe(before.raw.any.ALL + 10);
    expect(after.daysCovered).toBe(15);
    expect(after.viirsPlatform).toBe("NOAA-20");
    expect(after.value!).toBeGreaterThan(before.value!);
  });
});

describe("months without records", () => {
  it("are zeros (no matching records), not missing values, for every period class", async () => {
    const b = createBundle("us", { fetchImpl: fileFetch() });
    const m = await b.manifest();
    const { cal } = await b.calibration();
    const { ensureMonths } = await import("./series");
    const months: MonthZones = new Map();
    ensureMonths(months, ["2001-01", "2015-01", "2024-01"]);
    const res = harmonize(months, cal, { dataEnd: m.planEnd, planEnd: m.planEnd, aoiNoise: true });
    expect(res.map((r) => [r.month, r.cls, r.value, r.lo, r.hi, r.viirsLevel, r.raw.any.ALL])).toEqual([
      ["2001-01", "terra-only-estimated", 0, 0, 0, 0, 0],
      ["2015-01", "modis-observed", 0, 0, 0, 0, 0],
      ["2024-01", "viirs-estimated", 0, 0, 0, 0, 0],
    ]);
  });
});

describe("AOI shard planning", () => {
  it.each([
    ["Madrid box", [[[[-4.5, 39.8], [-3, 39.8], [-3, 41], [-4.5, 41], [-4.5, 39.8]]]]],
    ["most of Iberia", [[[[-9.6, 36.5], [3.5, 36.5], [3.5, 43.9], [-9.6, 43.9], [-9.6, 36.5]]]]],
  ])("full-zone shortcut equals filtering every shard (%s)", async (_name, polys) => {
    const { planAoi, zonesOnly } = await import("./series");
    const b = createBundle("iberia", { fetchImpl: fileFetch() });
    const m = await b.manifest();
    const { cal } = await b.calibration();
    const keep = makeAoiTest(polys as never);
    const brute: MonthZones = new Map(), fast: MonthZones = new Map();
    for (const f of m.files.filter((f) => f.path.startsWith("monthly/"))) addMonthly(brute, await b.partition(f.path), keep);
    const plan = planAoi((await b.partition("cells.json.gz")) as never, keep);
    addMonthly(fast, zonesOnly(await b.partition("zone-monthly.json.gz"), new Set(plan.full)), null);
    for (const s of plan.partial) addMonthly(fast, await b.partition(`monthly/${s}.json.gz`), keep);
    const opts = { dataEnd: m.planEnd, planEnd: m.planEnd };
    const key = (rs: ReturnType<typeof harmonize>) => rs.map((r) => [r.month, JSON.stringify(r.raw), r.value?.toFixed(6)]);
    expect(key(harmonize(fast, cal, opts))).toEqual(key(harmonize(brute, cal, opts)));
    expect(plan.full.length + plan.partial.length).toBeGreaterThan(0);
  });
});

describe("preset AOI files", () => {
  it.each([["us", "us-06"], ["us", "us-02"], ["iberia", "ib-620"]])("%s %s equals filtering the cell shards", async (region, id) => {
    const b = createBundle(region, { fetchImpl: fileFetch() });
    const m = await b.manifest();
    const { cal } = await b.calibration();
    const presets = JSON.parse(readFileSync(join(ROOT, "public/data/presets", `${region}.json`), "utf8")).items as Array<{ id: string; polys: never }>;
    const keep = makeAoiTest(presets.find((p) => p.id === id)!.polys);
    const viaShards: MonthZones = new Map(), viaPreset: MonthZones = new Map();
    for (const f of m.files.filter((f) => f.path.startsWith("monthly/"))) addMonthly(viaShards, await b.partition(f.path), keep);
    addMonthly(viaPreset, await b.partition(`aoi/${id}.json.gz`), null);
    const opts = { dataEnd: m.planEnd, planEnd: m.planEnd };
    const key = (mz: MonthZones) => harmonize(mz, cal, opts).map((r) => [r.month, JSON.stringify(r.raw), r.det.join(), r.value?.toFixed(6)]);
    expect(key(viaPreset)).toEqual(key(viaShards));
  });
});
