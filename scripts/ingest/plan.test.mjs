import { test } from "node:test";
import assert from "node:assert/strict";
import { windows, sourceSpans, planJobs } from "./plan.mjs";

test("windows split an inclusive range into <=5-day chunks with a short tail", () => {
  assert.deepEqual(windows("2024-01-01", "2024-01-12", 5), [
    { date: "2024-01-01", days: 5 },
    { date: "2024-01-06", days: 5 },
    { date: "2024-01-11", days: 2 },
  ]);
  assert.deepEqual(windows("2024-02-28", "2024-03-01", 5), [{ date: "2024-02-28", days: 3 }]);
  assert.deepEqual(windows("2024-03-02", "2024-03-01", 5), []);
});

const sources = [
  { id: "MODIS_SP", kind: "SP" },
  { id: "MODIS_NRT", kind: "NRT", after: "MODIS_SP" },
  { id: "VIIRS_NOAA21_SP", kind: "SP" },
  { id: "VIIRS_NOAA21_NRT", kind: "NRT", after: "VIIRS_NOAA21_SP" },
  { id: "VIIRS_SNPP_NRT", kind: "NRT", after: "VIIRS_SNPP_SP", endOfProduction: "2026-11-02" },
  { id: "VIIRS_SNPP_SP", kind: "SP" },
];
const availability = {
  MODIS_SP: { min: "2000-11-01", max: "2026-08-31" },
  MODIS_NRT: { min: "2026-09-01", max: "2026-11-15" },
  VIIRS_NOAA21_SP: { min: "2023-03-01", max: "2026-07-31" },
  VIIRS_NOAA21_NRT: { min: "2024-01-17", max: "2026-11-15" },
  VIIRS_SNPP_SP: { min: "2012-01-20", max: "2026-07-31" },
  VIIRS_SNPP_NRT: { min: "2026-08-01", max: "2026-11-02" },
};

test("NRT starts the day after its SP ends, even when NRT availability overlaps SP", () => {
  const spans = Object.fromEntries(sourceSpans(sources, availability, "2026-11-15").map((s) => [s.id, s]));
  assert.deepEqual([spans.VIIRS_NOAA21_NRT.start, spans.VIIRS_NOAA21_NRT.end], ["2026-08-01", "2026-11-15"]);
  assert.deepEqual([spans.MODIS_NRT.start, spans.MODIS_NRT.end], ["2026-09-01", "2026-11-15"]);
  assert.deepEqual([spans.VIIRS_SNPP_NRT.start, spans.VIIRS_SNPP_NRT.end], ["2026-08-01", "2026-11-02"]);
  assert.equal(spans.MODIS_SP.start, "2000-11-01");
});

test("NRT never extends past the requested end date (avoid partial today)", () => {
  const spans = Object.fromEntries(sourceSpans(sources, availability, "2026-11-14").map((s) => [s.id, s]));
  assert.equal(spans.MODIS_NRT.end, "2026-11-14");
});

test("SP and NRT spans of one platform never overlap (no double counting)", () => {
  const spans = Object.fromEntries(sourceSpans(sources, availability, "2026-11-15").map((s) => [s.id, s]));
  for (const s of sources.filter((x) => x.kind === "NRT"))
    assert.ok(spans[s.id].start > spans[s.after].end, s.id);
});

test("planJobs produces one job per source x box x window with stable ids", () => {
  const region = { id: "r", boxes: [{ id: "a", bbox: [0, 0, 1, 1] }, { id: "b", bbox: [1, 1, 2, 2] }] };
  const jobs = planJobs({ sources: [sources[0]], availability: { MODIS_SP: { min: "2024-01-01", max: "2024-01-07" } }, region, end: "2026-01-01" });
  assert.equal(jobs.length, 4);
  assert.equal(jobs[0].id, "r/MODIS_SP/a/2024-01-01_5");
  assert.equal(new Set(jobs.map((j) => j.id)).size, 4);
});
