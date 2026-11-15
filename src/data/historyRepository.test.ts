import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import Papa from "papaparse";
import { StaticHistoryRepository } from "./historyRepository";
import { normalizeRow } from "./normalize";
import { filterRecords } from "./analytics";
const localFetch =
  (decoded = false): typeof fetch =>
  async (input) => {
    const path = new URL(String(input), "http://localhost").pathname;
    try {
      const bytes = readFileSync(`public${path}`);
      return new Response(
        decoded && path.endsWith(".gz") ? gunzipSync(bytes) : bytes,
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  };
it("real static aggregates reconcile for sensors, platform, dates and missing periods", async () => {
  const repo = new StaticHistoryRepository("/data/history", localFetch());
  const m = await repo.manifest();
  const q = await repo.query(m, { start: "2023-01-01", end: "2025-12-31" });
  expect(q.activity.length).toBe(36);
  expect(q.activity.reduce((n, r) => n + (r.MODIS ?? 0), 0)).toBe(6827);
  expect(q.activity.reduce((n, r) => n + (r.VIIRS ?? 0), 0)).toBe(47364);
  expect(q.activity.find((r) => r.period === "2023-12")?.MODIS).toBeNull();
  expect(q.activity.find((r) => r.period === "2025-01")?.VIIRS).toBeNull();
  const aqua = await repo.query(m, {
    start: "2024-01-01",
    end: "2024-12-31",
    platform: "Aqua",
  });
  expect(aqua.activity.reduce((n, r) => n + (r.MODIS ?? 0), 0)).toBe(3231);
  expect(aqua.activity.every((r) => r.VIIRS === null)).toBe(true);
  const only = await repo.query(m, {
    start: "2024-01-01",
    end: "2024-12-31",
    sensor: "VIIRS",
  });
  expect(only.activity.every((r) => r.MODIS === null)).toBe(true);
  expect(q.pointsAvailable).toBe(false);
});
it("inclusive UTC dates reconcile with the original NASA points; auto-decoded gzip is verified", async () => {
  const repo = new StaticHistoryRepository("/data/history", localFetch(true)),
    m = await repo.manifest();
  const points = m.sources.flatMap((s) =>
    Papa.parse<Record<string, string>>(
      gunzipSync(
        readFileSync(`public/data/demo/v1/${s.path.split("/").at(-1)}.gz`),
      ).toString("utf8"),
      { header: true, skipEmptyLines: true },
    ).data.map((r) => normalizeRow(r, s.id)),
  );
  const start = "2024-02-15",
    end = "2024-03-10";
  const q = await repo.query(m, { start, end });
  const filtered = filterRecords(points, {
    start,
    end,
    sensor: "all",
    bounds: null,
    month: null,
  });
  for (const sensor of ["MODIS", "VIIRS"] as const)
    expect(q.activity.reduce((n, r) => n + (r[sensor] ?? 0), 0)).toBe(
      filtered.filter((r) => r.sensor === sensor).length,
    );
  expect(
    q.activity.every((r) => r.MODIS_status === "partial-record-interval"),
  ).toBe(true);
});
it("cell-center bounds are explicitly approximate and corrupt partitions fail closed", async () => {
  const repo = new StaticHistoryRepository("/data/history", localFetch()),
    m = await repo.manifest();
  const q = await repo.query(m, {
    start: "2024-01-01",
    end: "2024-01-31",
    bounds: { west: 170, south: -10, east: -170, north: 10 },
  });
  expect(q.geography).toMatch(/Approximate/);
  expect(q.activity[0].MODIS).toBe(0); // no loaded records here, never proof of coverage
  const tampered = structuredClone(m);
  tampered.partitions[0].sha256 = "bad";
  await expect(
    repo.query(tampered, {
      start: "2024-01-01",
      end: "2024-01-31",
      resolution: 4,
    }),
  ).rejects.toThrow(/integrity/);
  await expect(
    repo.query(m, { start: "2024-02-01", end: "2024-01-01" }),
  ).rejects.toThrow(/date/);
});
