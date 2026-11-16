// Investigation features: sensor disagreement (exact, exclusive, reconciling),
// the sensor-transition example, the regional brief, the evidence-lab data and
// the casebook numbers, all recomputed from the published bundle.
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createBundle, type Calibration } from "./bundle";
import { addMonthly, harmonize, regionReferenceX, type MonthResult, type MonthZones } from "./series";
import { atlasSummary, cellSplits, shares, split, overlapIssue } from "./disagreement";
import { readings, readingVerdict, trendReadings } from "./transition";
import { buildBrief, briefHtml, briefMarkdown } from "./brief";
import { INCIDENTS } from "./incidents";
import { CASES } from "./casebook";
import { rankMonths } from "./analysis";
import { analyzeSeason } from "./season";
import { encodeAoi } from "./aoi";
import { union, MODIS, VIIRS, ALL } from "./codec";

const ROOT = resolve(import.meta.dirname, "../../..");
const ff = (async (u: string | URL | Request) => { const p = join(ROOT, "public", String(u)); return existsSync(p) ? new Response(readFileSync(p) as Uint8Array<ArrayBuffer>) : new Response("x", { status: 404 }); }) as typeof fetch;
type L = { cal: Calibration; months: MonthResult[]; sha: string };
async function load(region: string, preset?: string): Promise<L> {
  const b = createBundle(region, { fetchImpl: ff });
  const [m, { cal, sha256 }, zm] = await Promise.all([b.manifest(), b.calibration(), b.partition("zone-monthly.json.gz")]);
  const reg: MonthZones = new Map(); addMonthly(reg, zm, null);
  let mz = reg;
  if (preset) { mz = new Map(); addMonthly(mz, await b.partition(`aoi/${preset}.json.gz`), null); for (const k of reg.keys()) if (!mz.has(k)) mz.set(k, new Map()); }
  const o = { dataEnd: m.planEnd, planEnd: m.planEnd };
  return { cal, sha: sha256, months: harmonize(mz, cal, { ...o, regionX: preset ? regionReferenceX(reg, cal, o) : undefined, aoiNoise: !!preset }) };
}
const loaded = new Map<string, L>();
beforeAll(async () => { for (const [k, r, p] of [["us", "us", undefined], ["iberia", "iberia", undefined], ["us-06", "us", "us-06"], ["us-48", "us", "us-48"]] as const) loaded.set(k, await load(r, p)); }, 120_000);

describe("sensor disagreement", () => {
  it("categories are exclusive and add up to the union for every month and overpass", () => {
    for (const r of loaded.get("us")!.months) for (const o of ["any", "day", "night"] as const) {
      const s = split(r.raw[o]);
      expect(s.modisOnly + s.viirsOnly + s.both).toBe(s.union);
      expect(Math.min(s.modisOnly, s.viirsOnly, s.both)).toBeGreaterThanOrEqual(0);
    }
  });
  it("matches a direct count from the platform masks", () => {
    // mask/count pairs: Terra 5, Terra+Aqua 2, S-NPP 7, Terra+S-NPP 6, NOAA-20 1, S-NPP+NOAA-20 9, NOAA-21 3, S-NPP+NOAA-21 4, Aqua+NOAA-20 2
    const h = [1, 5, 3, 2, 4, 7, 5, 6, 8, 1, 10, 2, 12, 9, 16, 3, 20, 4];
    const s = split({ M: union(h, MODIS), V: union(h, VIIRS), ALL: union(h, ALL) });
    expect(s).toEqual({ modisOnly: 5 + 2, viirsOnly: 7 + 1 + 9 + 3 + 4, both: 6 + 2, union: 39 });
  });
  it("uses only months both sensors observed completely, never before VIIRS", () => {
    const a = atlasSummary(loaded.get("us")!.months, "2000-11", "2026-10");
    expect(a.months[0].month).toBe("2012-01");
    expect(a.excluded.map((e) => e.month)).toContain("2012-01"); // S-NPP from the 20th
    expect(a.excluded.map((e) => e.month)).toContain("2024-07"); // S-NPP outage
    expect(a.used + a.excluded.length).toBe(a.months.length);
    expect(a.total.modisOnly + a.total.viirsOnly + a.total.both).toBe(a.total.union);
    const s = shares(a.total)!;
    expect(s.viirsOnly).toBeGreaterThan(0.6); // VIIRS sees most of the union
    expect(shares(a.night)!.viirsOnly).toBeGreaterThan(shares(a.day)!.viirsOnly);
  });
  it("map cells reconcile with the overview's union", () => {
    const o = JSON.parse(gunzipSync(readFileSync(join(ROOT, "public/data/v2/us/overview.json.gz"))).toString());
    const cells = cellSplits(o.rows, o.periods, 2012, 2026);
    let u = 0, sum = 0;
    for (const s of cells.values()) { u += s.union; sum += s.modisOnly + s.viirsOnly + s.both; }
    expect(sum).toBe(u);
    expect(u).toBe(o.rows.filter((w: number[]) => +o.periods[w[1]] >= 2012).reduce((t: number, w: number[]) => t + w[2], 0));
  });
  it("explains why a month is left out", () => {
    const r = loaded.get("us")!.months.find((m) => m.month === "2024-07")!;
    expect(overlapIssue(r)).toMatch(/S-NPP lost/);
  });
});

describe("sensor transition", () => {
  it("the naive splice turns a flat US record into a significant increase", () => {
    const t = trendReadings(loaded.get("us")!.months, 2003, 2025);
    expect(t.naive!.p).toBeLessThan(0.001);
    expect(t.naive!.pctPerDecade!).toBeGreaterThan(50);
    expect(t.harmonized!.p).toBeGreaterThan(0.5);
  });
  it("labels the naive splice as not comparable", () => {
    const r = readings(loaded.get("us")!.months, "2020-09")!;
    expect(r[0].comparable).toBe(false);
    expect(r[2].comparable).toBe(true);
    expect(readingVerdict(r[2])).toBe("unusually high");
  });
});

describe("evidence lab data", () => {
  it.each(["us", "iberia"])("%s: published held-out records reproduce the published metrics", (k) => {
    const v = loaded.get(k)!.cal.validation!;
    const sel = loaded.get(k)!.cal.selection.selected;
    const mae = v.heldOutMonths.reduce((s, h) => s + Math.abs(h[sel] - h.observed), 0) / v.heldOutMonths.length;
    expect(mae).toBeCloseTo(v.metrics[sel].mae, 0);
    expect(v.heldOutMonths.length).toBe(v.metrics[sel].n);
    expect(v.target).toMatch(/not ground truth/);
  });
  it("the small-area interval factor raises out-of-sample zone coverage to about 90%", () => {
    const ai = loaded.get("us")!.cal.aoiInterval!;
    expect(ai.outOfSample.before.all).toBeLessThan(0.82);
    expect(ai.outOfSample.after.all).toBeGreaterThanOrEqual(0.88);
    expect(ai.factor).toBeGreaterThan(1);
  });
  it("outage sensitivity: every documented notice is recovered under every variant", () => {
    for (const s of loaded.get("us")!.cal.coverageSensitivity!) expect(s.documentedRecovered).toBe(s.documented);
  });
});

describe("regional brief", () => {
  it("summarises California from existing statistics, with provenance and caveats", () => {
    const l = loaded.get("us-06")!;
    const br = buildBrief({ regionName: "United States", areaName: "California", aoiEncoded: "preset:us-06", cellRule: "rule", boundary: "b", months: l.months, from: "2003-01", to: "2025-12", focus: "2020-09", dataEnd: "2026-11-14", cal: l.cal, calSha: l.sha, manifestSha: "m", filesUsed: 3, events: null, url: "u", isSubArea: true });
    expect(br.peaks[0].key).toBe("2020-09");
    expect(br.unusual.some((u) => u.month === "2020-09" && u.high)).toBe(true);
    expect(br.uncertainty.aoiFactor).toBe(l.cal.aoiInterval!.factor);
    const md = briefMarkdown(br);
    expect(md).toMatch(/not burned area/);
    expect(md).toMatch(/not ground truth/);
    expect(md).toContain(l.sha);
  });
  it("Texas brief: planning context, season evolution, documented fires, incomplete month and scope", () => {
    const l = loaded.get("us-48")!;
    const incidents = INCIDENTS.filter((i) => i.preset === "us-48");
    const br = buildBrief({ regionName: "United States", areaName: "Texas", aoiEncoded: "preset:us-48", cellRule: "rule", boundary: "b", months: l.months, from: "2003-01", to: "2026-11", focus: "2011-04", dataEnd: "2026-11-14", cal: l.cal, calSha: l.sha, manifestSha: "m", filesUsed: 3, events: null, url: "u", isSubArea: true, incidents });
    expect(br.planning!.peak).toBe("Mar");
    expect(br.partialMonths.map((m) => m.month)).toEqual(["2026-11"]);
    const md = briefMarkdown(br);
    for (const t of ["## Planning context (historical pattern, not a forecast)", "## Fire season evolution", "Smokehouse Creek Fire", "Bastrop County Complex", "not a fire-danger rating", "Nov 2026 (data for 14 of 30 days)", "not a global historical database"]) expect(md).toContain(t);
    const html = briefHtml(br);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<h2>Fire season evolution</h2>");
    expect(html).toContain('<a href="https://tfsweb.tamu.edu/');
    expect(html).not.toMatch(/<script/i);
  });
});

describe("headline numbers quoted in submission/", () => {
  it("US 2003–2025: naive splice +72% per decade (p < 0.001) vs harmonized about 0 (p = 0.98); 71% VIIRS-only since 2012", () => {
    const l = loaded.get("us")!;
    const t = trendReadings(l.months, 2003, 2025);
    expect(Math.round(t.naive!.pctPerDecade!)).toBe(72);
    expect(t.naive!.p).toBeLessThan(0.001);
    expect(Math.abs(t.harmonized!.pctPerDecade!)).toBeLessThan(1);
    expect(t.harmonized!.p.toFixed(2)).toBe("0.98");
    const s = shares(atlasSummary(l.months, "2012-01", "2026-11").total)!;
    expect(Math.round(100 * s.viirsOnly)).toBe(71);
  });
});

describe("casebook numbers match the bundle", () => {
  it.each(CASES.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const l = loaded.get(c.aoi.kind === "preset" ? c.aoi.id : c.region)!;
    expect(encodeAoi(c.aoi)).toBeTruthy();
    const range = l.months.filter((m) => m.month >= c.from && m.month <= c.to);
    const top = rankMonths(range, "modis-eq", 2);
    expect(top[0].key).toBe(c.focus);
    expect(Math.round(top[0].value)).toBe(c.check.focusValue);
    expect(top[1].key).toBe(c.check.runnerUp.month);
    expect(Math.round(top[1].value)).toBe(c.check.runnerUp.value);
    const f = l.months.find((m) => m.month === c.focus)!;
    if (c.check.focusLo == null) expect(f.cls).toBe("modis-observed");
    else { expect(Math.round(f.lo!)).toBe(c.check.focusLo); expect(Math.round(f.hi!)).toBe(c.check.focusHi); }
    const t = trendReadings(l.months, +c.from.slice(0, 4), +c.to.slice(0, 4));
    expect(Math.round(t.naive!.pctPerDecade!)).toBe(c.check.naivePerDecade);
    expect(Math.round(t.harmonized!.pctPerDecade!)).toBe(c.check.harmonizedPerDecade);
    expect(t.naive!.p.toFixed(c.check.naiveP.length - 2)).toBe(c.check.naiveP);
    expect(t.harmonized!.p.toFixed(c.check.harmonizedP.length - 2)).toBe(c.check.harmonizedP);
    const s = shares(atlasSummary(l.months, "2012-01", c.to).total)!;
    expect(Math.abs(100 * s.viirsOnly - c.check.viirsOnlyPct)).toBeLessThanOrEqual(1);
    expect(Math.abs(100 * s.both - c.check.bothPct)).toBeLessThanOrEqual(1);
    expect(Math.abs(100 * s.modisOnly - c.check.modisOnlyPct)).toBeLessThanOrEqual(1);
    if (c.check.notTop) expect(rankMonths(range, "modis-eq", c.check.notTop.n).map((t) => t.key)).not.toContain(c.check.notTop.month);
    if (c.check.seasonPeak) {
      const s = analyzeSeason(l.months);
      expect(s.profiles.slice(0, 2).map((p) => p.peakMonth + 1)).toEqual([c.check.seasonPeak, c.check.seasonPeak]);
      expect(Math.min(...s.tests!.map((t) => t.pHolm))).toBeGreaterThanOrEqual(0.05); // text says no change survives
    }
    for (const n of [c.check.focusValue, c.check.runnerUp.value, Math.abs(c.check.naivePerDecade), Math.abs(c.check.harmonizedPerDecade)]) expect(c.finding + c.sensors).toContain(n.toLocaleString("en-US"));
  });
});
