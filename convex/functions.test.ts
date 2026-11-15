// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./pull.ts"]);
const t = () => convexTest(schema, modules);
afterEach(() => vi.unstubAllEnvs());

describe("ledger.reserve", () => {
  it("enforces the 10-minute FIRMS budget and the daily export budget", async () => {
    vi.stubEnv("FIRMS_TX_PER_10MIN", "100");
    vi.stubEnv("EXPORT_TX_PER_DAY", "150");
    const c = t();
    expect((await c.mutation(internal.ledger.reserve, { tx: 60, purpose: "pull" })).ok).toBe(true);
    const denied = await c.mutation(internal.ledger.reserve, { tx: 50, purpose: "export" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toMatch(/60\/100/);
    expect((await c.mutation(internal.ledger.reserve, { tx: 40, purpose: "export" })).ok).toBe(true);
  });
});

describe("NRT day storage and public queries", () => {
  const day = (d: string) => ({ region: "us", day: d, total: "[-1,0,[],[],[],[0,0,0,0,0],[0,0,0,0,0]]", partition: `{"periods":["${d}"]}`, fineCellDays: 0, detections: 0, sources: ["VIIRS_NOAA20_NRT"], fetchedAt: Date.parse(`${d}T12:00:00Z`) });

  it("replaces a day instead of duplicating it, prunes bundle-covered days, filters by date", async () => {
    const c = t();
    await c.mutation(internal.ingest.writeDay, day("2026-11-14"));
    await c.mutation(internal.ingest.writeDay, day("2026-11-15"));
    await c.mutation(internal.ingest.writeDay, { ...day("2026-11-15"), fineCellDays: 7 });
    expect(await c.query(internal.ingest.latestDay, { region: "us" })).toBe("2026-11-15");
    let totals = await c.query(api.live.dayTotals, { region: "us", after: "2026-11-01" });
    expect(totals.map((d) => [d.day, d.fineCellDays])).toEqual([["2026-11-14", 0], ["2026-11-15", 7]]);
    expect(totals[1].provisional).toBe(true);
    await c.mutation(internal.ingest.prune, { region: "us", through: "2026-11-14" });
    totals = await c.query(api.live.dayTotals, { region: "us", after: "2026-11-01" });
    expect(totals.map((d) => d.day)).toEqual(["2026-11-15"]);
    const cells = await c.query(api.live.dayCells, { region: "us", days: ["2026-11-14", "2026-11-15"] });
    expect(cells.map((x) => x.day)).toEqual(["2026-11-15"]);
  });

  it("validates public query arguments", async () => {
    const c = t();
    await expect(c.query(api.live.dayTotals, { region: "mars", after: "2026-11-01" })).rejects.toThrow(/unknown region/);
    await expect(c.query(api.live.dayTotals, { region: "us", after: "yesterday" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(c.query(api.live.dayCells, { region: "us", days: Array(17).fill("2026-11-15") })).rejects.toThrow(/at most 16/);
  });

  it("reports per-region status without exposing secrets", async () => {
    const c = t();
    await c.mutation(internal.ingest.recordRun, { region: "us", startedAt: 1, finishedAt: 2, ok: false, days: 0, detections: 0, tx: 0, error: "FIRMS HTTP 500" });
    const s = await c.query(api.live.status, {});
    expect(s.map((r) => r.region).sort()).toEqual(["iberia", "us"]);
    expect(s.find((r) => r.region === "us")!.lastRun).toMatchObject({ ok: false, error: "FIRMS HTTP 500" });
  });
});

describe("HTTP export", () => {
  it("rejects invalid requests before touching FIRMS", async () => {
    const c = t();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await c.fetch("/hotspots.csv?bbox=1,2,3&start=2026-11-01");
    expect(r.status).toBe(400);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await r.json()).error).toMatch(/four numbers/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("fails closed without a key and never echoes one", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "");
    const r = await t().fetch("/hotspots.csv?bbox=-120,30,-110,40&start=2026-11-01");
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/FIRMS_MAP_KEY is not set/);
  });
  it("redacts the key from upstream errors", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "secret-key-123");
    const c = t();
    await c.mutation(internal.ingest.setMeta, { key: "availability", value: JSON.stringify({ MODIS_NRT: { min: "2026-09-01", max: "2026-11-15" } }) });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(`bad key ${String(url)}`, { status: 500 }));
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5000 });
    const r = await c.fetch("/hotspots.csv?bbox=-120,30,-110,40&start=2026-11-01&sensors=modis");
    vi.useRealTimers();
    const body = await r.text();
    expect(r.status).toBe(502);
    expect(body).not.toContain("secret-key-123");
    expect(body).toContain("<MAP_KEY>");
    fetchSpy.mockRestore();
  });
});
