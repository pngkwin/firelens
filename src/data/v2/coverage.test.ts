// Observation-coverage audit (method v3): detector rules on synthetic data, and
// regression checks on the published bundle for the satellite outages found in
// the scientific audit (S-NPP July 2024, August 2022, July 2025; Terra 2001;
// Aqua 2022), pre-launch raw scales, baselines and trends, and export
// consistency.
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { detectCoverage, flaggedDays, materialLoss, type DocumentedEvent } from "./coverage";
import { createBundle, type Calibration } from "./bundle";
import { addDaily, addMonthly, harmonize, harmonizeDays, type DayResult, type DayVals, type MonthResult, type MonthZones } from "./series";
import { annualTotals, annualTrend, compareFocus, dayStatus, monthAnomalies, monthStatus, monthValue, rankMonths } from "./analysis";
import { recentWindow } from "./earlyWarning";
import { monthlyCsv, MONTHLY_COLUMNS } from "./exportsV2";

// ---- synthetic detector tests -----------------------------------------------------
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
/** 120 days of S-NPP ≈ NOAA-20 detections; `f` overrides one day's counts. */
function series(f: (d: string, base: number[]) => number[] = (_, b) => b, base = [100, 100, 500, 500, 0]) {
  return new Map(days("2020-04-01", 120).map((d) => [d, f(d, [...base])]));
}
const OP = { Terra: ["2020-01-01", "2020-12-31"], Aqua: ["2020-01-01", "2020-12-31"], "S-NPP": ["2020-01-01", "2020-12-31"], "NOAA-20": ["2020-01-01", "2020-12-31"] } as Record<string, [string, string]>;

describe("gap detector", () => {
  it("never flags zero detections that the other satellites cannot contradict", () => {
    // A quiet day: every satellite sees (almost) nothing, so zero is plausible fire absence.
    const c = detectCoverage(series((d, b) => (d === "2020-06-01" ? [0, 0, 0, 3, 0] : b)), OP);
    expect(flaggedDays(c, "S-NPP", "2020-06-01", "2020-06-01")).toBe(0);
    expect(c.undeterminedZeroDays["S-NPP"]).toBeGreaterThan(0);
  });
  it("flags a gap when another satellite observing the same day saw plenty of fire", () => {
    const c = detectCoverage(series((d, b) => (d >= "2020-06-01" && d <= "2020-06-05" ? [100, 100, 0, 500, 0] : b)), OP);
    expect(Object.keys(c.flagged["S-NPP"]!)).toEqual(days("2020-06-01", 5));
    expect(c.events).toHaveLength(1);
    expect(c.events[0]).toMatchObject({ platform: "S-NPP", start: "2020-06-01", end: "2020-06-05", gapDays: 5, status: "suspected", evidence: ["cross-satellite"] });
    expect(flaggedDays(c, "NOAA-20", "2020-04-01", "2020-07-29")).toBe(0);
  });
  it("flags a partial-day loss of a VIIRS satellite as reduced", () => {
    const c = detectCoverage(series((d, b) => (d === "2020-06-10" ? [100, 100, 150, 500, 0] : b)), OP);
    expect(c.flagged["S-NPP"]?.["2020-06-10"]).toBe("reduced");
  });
  it("labels a detected gap confirmed only when a documented notice overlaps it", () => {
    const doc: DocumentedEvent[] = [{ id: "x", platform: "S-NPP", start: "2020-06-02", end: "2020-06-03", kind: "outage", title: "t", sources: [] }];
    const c = detectCoverage(series((d, b) => (d >= "2020-06-01" && d <= "2020-06-05" ? [100, 100, 0, 500, 0] : b)), OP, doc);
    expect(c.events[0]).toMatchObject({ status: "confirmed", documented: ["x"] });
  });
  it("does not flag a documented outage when the records show normal observations", () => {
    const doc: DocumentedEvent[] = [{ id: "y", platform: "NOAA-20", start: "2020-06-02", end: "2020-06-03", kind: "outage", title: "t", sources: [] }];
    const c = detectCoverage(series(), OP, doc);
    expect(c.flagged["NOAA-20"]).toBeUndefined();
    expect(c.documentedWithoutDetectedLoss).toEqual(["y"]);
  });
  it("flags documented outage days with zero detections even when the data alone cannot judge", () => {
    const doc: DocumentedEvent[] = [{ id: "z", platform: "S-NPP", start: "2020-06-02", end: "2020-06-02", kind: "outage", title: "t", sources: [] }];
    // Quiet day for everyone: data alone is undetermined, the notice plus zero detections decides.
    const c = detectCoverage(series((d, b) => (d === "2020-06-02" ? [1, 1, 0, 4, 0] : b)), OP, doc);
    expect(c.flagged["S-NPP"]?.["2020-06-02"]).toBe("gap");
    expect(c.events[0].evidence).toEqual(["documented-zero"]);
  });
  it("uses climatology (other years) when no second satellite exists, with a strict threshold", () => {
    const daily = new Map<string, number[]>();
    for (const y of [2001, 2002, 2003]) for (const d of days(`${y}-06-01`, 30)) daily.set(d, [y === 2001 && d <= "2001-06-10" ? 0 : y === 2001 && d === "2001-06-20" ? 30 : 300, 0, 0, 0, 0]);
    const c = detectCoverage(daily, { Terra: ["2001-01-01", "2003-12-31"] });
    expect(Object.keys(c.flagged.Terra!).sort()).toEqual(days("2001-06-01", 10)); // zero: flagged
    expect(c.flagged.Terra!["2001-06-20"]).toBeUndefined(); // 10% of normal: a quiet day, not proof of an outage
    expect(c.events[0].evidence).toEqual(["climatology"]);
  });
  it("measures the share of a month's expected detections lost", () => {
    const c = detectCoverage(series((d, b) => (d >= "2020-06-01" && d <= "2020-06-06" ? [100, 100, 0, 500, 0] : b)), OP);
    expect(c.monthLoss["S-NPP"]!["2020-06"]).toBeCloseTo(6 / 30, 2);
    expect(materialLoss(c, "S-NPP", "2020-06")).toBe(true);
    expect(materialLoss(c, "S-NPP", "2020-05")).toBe(false);
  });
});

// ---- published bundle --------------------------------------------------------------
const ROOT = resolve(import.meta.dirname, "../../..");
const fileFetch = (async (url: string | URL | Request) => {
  const p = join(ROOT, "public", String(url));
  return existsSync(p) ? new Response(readFileSync(p) as Uint8Array<ArrayBuffer>) : new Response("missing", { status: 404 });
}) as typeof fetch;
type Loaded = { cal: Calibration; months: MonthResult[]; days: DayResult[]; by: Map<string, MonthResult>; observed: Map<string, number> };
async function load(region: string): Promise<Loaded> {
  const b = createBundle(region, { fetchImpl: fileFetch });
  const [m, { cal }, zm, rd] = await Promise.all([b.manifest(), b.calibration(), b.partition("zone-monthly.json.gz"), b.partition("region-daily.json.gz")]);
  const mz: MonthZones = new Map();
  addMonthly(mz, zm, null);
  const months = harmonize(mz, cal, { dataEnd: m.planEnd, planEnd: m.planEnd });
  const dv: DayVals = new Map();
  addDaily(dv, rd, null);
  const observed = new Map(months.map((r) => [r.month, r.raw.any.M]));
  return { cal, months, days: harmonizeDays(dv, months, cal.coverage), by: new Map(months.map((r) => [r.month, r])), observed };
}
let us: Loaded, ib: Loaded;
beforeAll(async () => { [us, ib] = await Promise.all([load("us"), load("iberia")]); }, 120_000);

describe("published coverage audit", () => {
  it("recovers every documented outage from the records and labels it confirmed", () => {
    const docs = (JSON.parse(readFileSync(join(ROOT, "config/observation-events.json"), "utf8")) as { events: DocumentedEvent[] }).events;
    expect(us.cal.coverage.documentedWithoutDetectedLoss).toEqual([]);
    for (const d of docs) expect(us.cal.coverage.events.some((e) => e.documented.includes(d.id) && e.status === "confirmed")).toBe(true);
    // Same audit for both regions (outages are spacecraft-wide; evidence pools all regions).
    expect(ib.cal.coverage.events).toEqual(us.cal.coverage.events);
  });
  it("flags the S-NPP outages of July 2024, August 2022 and July 2025", () => {
    const cov = us.cal.coverage;
    expect(flaggedDays(cov, "S-NPP", "2024-07-10", "2024-07-15")).toBe(6); // GPS anomaly, processing suspended
    expect(flaggedDays(cov, "S-NPP", "2024-07-24", "2024-07-28")).toBe(5); // safe hold
    expect(flaggedDays(cov, "S-NPP", "2022-07-27", "2022-08-10")).toBe(15); // safe mode
    expect(flaggedDays(cov, "S-NPP", "2025-07-05", "2025-07-07")).toBe(3); // suspected (no notice found)
    for (const m of ["2024-07", "2022-08", "2025-07"]) expect(materialLoss(cov, "S-NPP", m)).toBe(true);
    expect(flaggedDays(cov, "NOAA-20", "2024-07-01", "2024-07-31")).toBe(0);
  });
});

describe("reference satellite and harmonized values in outage months", () => {
  it.each([["2024-07"], ["2022-08"], ["2025-07"]])("US %s uses a fully observing VIIRS satellite and agrees with observed MODIS", (m) => {
    const r = us.by.get(m)!;
    expect(r.cls).toBe("viirs-estimated");
    expect(r.viirsPlatform).toBe("NOAA-20");
    expect(r.reduced).toBe(false);
    // Before the fix July 2024 came out at 7,697 against 15,582 observed (ratio 2.02).
    const ratio = us.observed.get(m)! / r.value!;
    expect(ratio).toBeGreaterThan(0.89);
    expect(ratio).toBeLessThan(1.13);
  });
  it.each([["2024-07"], ["2022-08"]])("Iberia %s uses NOAA-20, not the S-NPP with missing days", (m) => {
    expect(ib.by.get(m)!.viirsPlatform).toBe("NOAA-20");
    expect(ib.observed.get(m)! / ib.by.get(m)!.value!).toBeLessThan(1.25); // was 1.97 (2024-07) and 1.62 (2022-08)
  });
  it("July 2024 is no longer a false low anomaly", () => {
    const c = compareFocus(us.months, us.days, "2024-07", "modis-eq")!;
    expect(c.blocked).toBeNull();
    expect(c.boundsAgree).not.toBe("below");
    expect(c.stats!.pctOfMedian!).toBeGreaterThan(100);
  });
  it("keeps outage days unavailable (null), never zero, and spreads values by the observing satellite", () => {
    const day = (d: string) => us.days.find((x) => x.day === d)!;
    expect(day("2024-07-12").flagged).toContain("S-NPP");
    expect(day("2024-07-12").value).toBeGreaterThan(0); // NOAA-20 shape
    // Terra-only era, Terra not observing: no record at all, and the day is reported as not observed (not zero).
    expect(us.days.find((x) => x.day === "2001-06-20")).toBeUndefined();
    expect(dayStatus("2001-06-20", "modis-eq", us.cal.coverage, us.by.get("2001-06"))).toMatchObject({ observed: false });
    expect(dayStatus("2001-06-20", "modis-eq", us.cal.coverage, us.by.get("2001-06")).reasons[0]).toMatch(/Terra not observing \(confirmed/);
  });
});

describe("Terra-only era and observed era with outages", () => {
  it("marks June/July 2001 (Terra power supply failure) as reduced and withholds comparisons", () => {
    for (const m of ["2001-06", "2001-07"]) {
      const r = us.by.get(m)!;
      expect(r.reduced).toBe(true);
      expect(monthStatus(r, "modis-eq").reasons.join(" ")).toMatch(/Terra not observing/);
      const c = compareFocus(us.months, us.days, m, "modis-eq")!;
      expect(c.blocked).toMatch(/reduced satellite coverage/);
      expect(c.stats).toBeNull();
    }
  });
  it("marks February 2016 (Terra safe mode) reduced and leaves it out of other months' baselines", () => {
    expect(us.by.get("2016-02")!.reduced).toBe(true);
    const c = compareFocus(us.months, us.days, "2015-02", "modis-eq")!;
    expect(c.history.map((h) => h.year)).not.toContain(2016);
    expect(monthAnomalies(us.months, "modis-eq").get("2016-02")).toBeNull();
  });
  it("labels observed and estimated months correctly", () => {
    expect(us.by.get("2001-06")!.method).toBe("terra-scaling");
    expect(us.by.get("2015-08")!.method).toBe("observed");
    expect(us.by.get("2024-07")!.method).toBe("stratified");
    expect(ib.by.get("2024-07")!.method).toBe("qm");
  });
});

describe("raw scales: pre-launch periods and satellite configurations", () => {
  it("has no value (not zero) for VIIRS before S-NPP", () => {
    const r = us.by.get("2005-07")!;
    expect(monthValue(r, "raw-viirs")).toBeNull();
    expect(monthValue(r, "hotspots-viirs")).toBeNull();
    expect(monthStatus(r, "raw-viirs").available).toBe(false);
    expect(monthValue(r, "raw-modis")).toBeGreaterThan(0);
    expect(dayStatus("2005-07-01", "raw-viirs", us.cal.coverage).observed).toBe(false);
    expect(dayStatus("2024-07-12", "raw-viirs", us.cal.coverage)).toMatchObject({ observed: true, reduced: true });
  });
  it("compares raw VIIRS only with years observed by the same satellites", () => {
    const c = compareFocus(us.months, us.days, "2013-07", "raw-viirs")!;
    expect(c.blocked).toBeNull();
    expect(c.history.every((h) => h.year >= 2012 && h.year <= 2017)).toBe(true); // S-NPP alone
    expect(Math.min(...c.history.map((h) => h.value))).toBeGreaterThan(0); // no pre-launch zeros
    // Three-satellite era: only 2023-2026 Julys exist, two of them with S-NPP outages.
    expect(compareFocus(us.months, us.days, "2024-07", "raw-viirs")!.blocked).toMatch(/reduced satellite coverage/);
  });
  it("no longer reports the +121%/decade raw-VIIRS trend", () => {
    const tr = annualTrend(annualTotals(us.months, "raw-viirs"), 2001, 2025, "raw-viirs");
    // 2024-2025 (three satellites) carry S-NPP outages; the latest clean single-configuration years are 2019-2021 (S-NPP + NOAA-20).
    expect(tr.config).toBe("S-NPP+NOAA-20");
    expect(tr.years.every((y) => y >= 2019 && y <= 2022)).toBe(true);
    expect(tr.trend).toBeNull(); // fewer than 4 years with one satellite set
    expect(tr.note).toMatch(/not comparable/);
    expect(tr.excluded.some((e) => e.year === 2005)).toBe(false); // 2005 has no raw-VIIRS value at all
    const modis = annualTrend(annualTotals(us.months, "raw-modis"), 2001, 2025, "raw-modis");
    expect(modis.config).toBe("Terra+Aqua");
    expect(modis.years).not.toContain(2001); // Terra only
    expect(modis.trend).not.toBeNull();
  });
  it("ranks raw months only within the latest satellite configuration", () => {
    const top = rankMonths(us.months, "raw-viirs", 10);
    expect(top.every((t) => t.key >= "2023-03" && t.key <= "2026-10")).toBe(true); // latest complete month (Oct 2026): S-NPP + NOAA-20 + NOAA-21
  });
  it("early-warning baselines skip pre-launch and differently equipped years", () => {
    const w = recentWindow(us.days, "2026-10-31", 30, "raw-viirs", "2000-11-01", (d) => dayStatus(d, "raw-viirs", us.cal.coverage, us.by.get(d.slice(0, 7))));
    expect(w.history.every((h) => h.year >= 2023)).toBe(true);
  });
});

describe("harmonized trend and exports", () => {
  it("leaves years with material outages out of the trend", () => {
    const tr = annualTrend(annualTotals(us.months, "modis-eq"), 2001, 2025, "modis-eq");
    expect(tr.trend).not.toBeNull();
    expect(tr.excluded.map((e) => e.year)).toContain(2001);
    for (const e of tr.excluded) expect(e.reason).toMatch(/satellite outage/);
  });
  it("exports what the app displays", () => {
    const anomalies = monthAnomalies(us.months, "modis-eq");
    const lines = monthlyCsv(us.months, anomalies).trim().split("\n");
    const col = (row: string[], k: string) => row[MONTHLY_COLUMNS.indexOf(k as never)];
    const rows = new Map(lines.slice(1).map((l) => { const r = l.split(","); return [r[0], r]; }));
    for (const m of ["2001-06", "2005-07", "2016-02", "2024-07"]) {
      const r = us.by.get(m)!, row = rows.get(m)!;
      expect(Number(col(row, "modis_eq_fire_cell_days"))).toBeCloseTo(monthValue(r, "modis-eq")!, 0);
      expect(col(row, "modis_eq_coverage")).toBe(monthStatus(r, "modis-eq").reduced ? "reduced" : "full");
      const a = anomalies.get(m);
      expect(col(row, "same_month_years")).toBe(a ? String(a.n) : "");
    }
    expect(col(rows.get("2005-07")!, "raw_viirs")).toBe(""); // not in orbit: empty, not 0
    expect(col(rows.get("2005-07")!, "raw_snpp")).toBe("");
    expect(col(rows.get("2001-06")!, "modis_eq_coverage")).toBe("reduced");
    expect(col(rows.get("2001-06")!, "satellite_outages")).toMatch(/^Terra 16 d/);
    expect(col(rows.get("2024-07")!, "viirs_reference_platform")).toBe("NOAA-20");
  });
});

// Keep the raw region-daily file name in one place for the gzip check below.
it("region-daily evidence files are the ones recorded in the calibration", () => {
  for (const r of ["us", "iberia"]) {
    const buf = readFileSync(join(ROOT, "public/data/v2", r, "region-daily.json.gz"));
    expect(gunzipSync(buf).length).toBeGreaterThan(0);
  }
  expect(us.cal.coverage.inputs?.map((i) => i.region)).toEqual(["iberia", "us"]);
});
