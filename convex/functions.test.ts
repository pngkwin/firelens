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
    expect(s.find((r) => r.region === "us")!.lastRun).toMatchObject({ ok: false, error: "FIRMS unavailable" });
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
    vi.stubEnv("FIRMS_MAP_KEY", "0123456789abcdef0123456789abcdef");
    const c = t();
    await c.mutation(internal.ingest.setMeta, { key: "availability", value: JSON.stringify({ MODIS_NRT: { min: "2026-09-01", max: "2026-11-15" } }) });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(`bad key ${String(url)}`, { status: 500 }));
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5000 });
    const r = await c.fetch("/hotspots.csv?bbox=-120,30,-110,40&start=2026-11-01&sensors=modis");
    vi.useRealTimers();
    const body = await r.text();
    expect(r.status).toBe(502);
    expect(body).not.toContain("0123456789abcdef0123456789abcdef");
    expect(body).toContain("<MAP_KEY>");
    fetchSpy.mockRestore();
  });
});

describe("export abuse limits (SEC-1)", () => {
  it("keeps a share of the 10-minute budget for the daily pull", async () => {
    vi.stubEnv("FIRMS_TX_PER_10MIN", "1500");
    vi.stubEnv("EXPORT_TX_PER_10MIN", "1000");
    const c = t();
    // Exports from many clients fill the export share...
    for (let i = 0; i < 5; i++) expect((await c.mutation(internal.ledger.reserve, { tx: 200, purpose: "export", client: `c${i}` })).ok).toBe(true);
    const more = await c.mutation(internal.ledger.reserve, { tx: 10, purpose: "export", client: "c9" });
    expect(more.ok).toBe(false);
    if (!more.ok) expect(more.reason).toMatch(/export budget: 1000\/1000/);
    // ...and the pull still gets its budget.
    expect((await c.mutation(internal.ledger.reserve, { tx: 72, purpose: "pull" })).ok).toBe(true);
  });

  it("limits one client per hour without blocking others", async () => {
    vi.stubEnv("EXPORT_TX_PER_CLIENT_HOUR", "300");
    vi.stubEnv("EXPORT_TX_PER_10MIN", "1000");
    const c = t();
    expect((await c.mutation(internal.ledger.reserve, { tx: 200, purpose: "export", client: "a" })).ok).toBe(true);
    const again = await c.mutation(internal.ledger.reserve, { tx: 200, purpose: "export", client: "a" });
    expect(again.ok).toBe(false);
    if (!again.ok) { expect(again.reason).toMatch(/this client: 200\/300/); expect(again.retryAfterMs).toBeGreaterThan(0); }
    expect((await c.mutation(internal.ledger.reserve, { tx: 200, purpose: "export", client: "b" })).ok).toBe(true);
  });

  it("hashes the client address and never stores it", async () => {
    const { clientId } = await import("./http");
    const a = await clientId(new Request("https://x/hotspots.csv", { headers: { "X-Forwarded-For": "203.0.113.7, 10.0.0.1" } }));
    const b = await clientId(new Request("https://x/hotspots.csv", { headers: { "X-Forwarded-For": "203.0.113.8" } }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203.0.113.7");
    expect(a).not.toBe(b);
  });
});

describe("key redaction and status disclosure (SEC-2, SEC-3)", () => {
  const KEY = "0123456789abcdef0123456789abcdef";
  it("redacts the exact key, a case-changed echo and any key-shaped token, not SHA-256 hashes", async () => {
    const { redact } = await import("./lib/nrtCore");
    const sha = "a".repeat(64);
    const out = redact(`url /api/area/csv/${KEY}/X up ${KEY.toUpperCase()} other ${"f".repeat(32)} sha ${sha}`, KEY);
    expect(out).not.toMatch(/0123456789abcdef/i);
    expect(out).not.toContain("f".repeat(32) + " ");
    expect(out.match(/<MAP_KEY>/g)).toHaveLength(3);
    expect(out).toContain(sha);
  });

  it("fails closed on a malformed key without echoing it", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "not-a-key-value");
    const r = await t().fetch("/hotspots.csv?bbox=-120,30,-110,40&start=2026-11-01");
    const body = await r.text();
    expect(r.status).toBe(502);
    expect(body).toMatch(/not 32 hexadecimal/);
    expect(body).not.toContain("not-a-key-value");
  });

  it("redacts availability errors that echo the URL", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", KEY);
    const { fetchAvailability } = await import("./firms");
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(`error for ${String(url)}`, { status: 500 }));
    const err = await fetchAvailability(KEY).catch((e: Error) => e.message);
    spy.mockRestore();
    expect(err).toContain("<MAP_KEY>");
    expect(err).not.toContain(KEY);
  });

  it("live:status returns an error class, not upstream text", async () => {
    const c = t();
    await c.mutation(internal.ingest.recordRun, { region: "us", startedAt: 1, finishedAt: 2, ok: false, days: 0, detections: 0, tx: 0, error: "FIRMS HTTP 503: <html>upstream body with internal detail</html>" });
    await c.mutation(internal.ingest.recordRun, { region: "iberia", startedAt: 1, finishedAt: 2, ok: false, days: 0, detections: 0, tx: 0, error: "FIRMS budget: 1500/1500 transactions used in the last 10 minutes" });
    const s = await c.query(api.live.status, {});
    const err = Object.fromEntries(s.map((r) => [r.region, r.lastRun?.error]));
    expect(err).toEqual({ us: "FIRMS unavailable", iberia: "FIRMS transaction budget reached" });
    expect(JSON.stringify(s)).not.toContain("upstream body");
  });
});

describe("CSV formula guard (SEC-5)", () => {
  it("prefixes formula-like text and keeps numbers, including negative longitudes", async () => {
    const { exportCsvText } = await import("./lib/nrtCore");
    const csv = "latitude,longitude,acq_date,acq_time,satellite,daynight,confidence,frp,brightness,bright_t31,scan,track,version,type\n38.1,-120.5,2026-11-01,0930,T,D,80,12.5,320,290,1,1,=cmd|' /C calc'!A0,0\n";
    const line = exportCsvText("MODIS_NRT", csv).trim();
    expect(line).toContain(",-120.5,");
    expect(line).toContain("'=cmd");
    expect(line).not.toMatch(/,=cmd/);
  });
});
