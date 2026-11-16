import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Only aggregates live here. Raw FIRMS points are never stored: the daily pull
// aggregates in memory and the CSV export streams through.
export default defineSchema({
  // Whole-region total for one NRT day (small; the region-wide calendar reads only this).
  nrtDayTotals: defineTable({
    region: v.string(),
    day: v.string(), // YYYY-MM-DD (UTC)
    total: v.string(), // JSON WireRow, cell index -1 (src/data/v2/codec.ts)
    fineCellDays: v.number(),
    detections: v.number(), // retained detections (after clip and static mask)
    sources: v.array(v.string()), // FIRMS products fetched for this day
    fetchedAt: v.number(), // ms since epoch
  }).index("by_region_day", ["region", "day"]),

  // res-5 cells for one NRT day, as a JSON V2Partition (for AOI queries).
  nrtDayCells: defineTable({
    region: v.string(),
    day: v.string(),
    partition: v.string(),
    bytes: v.number(),
  }).index("by_region_day", ["region", "day"]),

  // FIRMS availability (data_availability), refreshed by each pull.
  meta: defineTable({ key: v.string(), value: v.string(), updatedAt: v.number() }).index("by_key", ["key"]),

  // Every FIRMS area-API transaction spent from Convex (2 per day of window).
  // client: SHA-256 of the export caller's address (exports only; per-client hourly limit).
  firmsLedger: defineTable({ at: v.number(), tx: v.number(), purpose: v.string(), client: v.optional(v.string()) }).index("by_at", ["at"]),

  // One row per pull (status page and debugging). Errors are key-redacted.
  runs: defineTable({
    region: v.string(),
    startedAt: v.number(),
    finishedAt: v.number(),
    ok: v.boolean(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    days: v.number(),
    detections: v.number(),
    tx: v.number(),
    error: v.optional(v.string()),
    stats: v.optional(v.string()), // JSON: excludedStatic, outsideRegion, rejected, detectionsBySource
  }).index("by_region_started", ["region", "startedAt"]),
});
