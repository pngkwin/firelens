// Public read API for the browser. Only aggregates; no key, no raw points.
import { query } from "./_generated/server";
import { v } from "convex/values";
import { REGIONS, regionIds } from "./regions";
import { isDate } from "./lib/nrtCore";

const MAX_TOTAL_DAYS = 400;
const MAX_CELL_DAYS = 16;
// A day counts as provisional until 36 h after it starts (NRT keeps filling).
const provisional = (day: string, fetchedAt: number) => fetchedAt < Date.parse(`${day}T00:00:00Z`) + 36 * 3_600_000;

function checkRegion(region: string) {
  if (!REGIONS[region]) throw Error(`unknown region "${region}" (expected one of ${regionIds.join(", ")})`);
}

/**
 * Public, short error class for a failed run. The full (key-redacted) text,
 * which can include upstream response bodies, stays in the `runs` table.
 */
export function errorClass(error: string | undefined | null): string | null {
  if (!error) return null;
  if (/budget/i.test(error)) return "FIRMS transaction budget reached";
  if (/FIRMS_MAP_KEY/.test(error)) return "backend not configured";
  if (/FIRMS|fetch|abort|timeout|network|Unexpected/i.test(error)) return "FIRMS unavailable";
  return "pull failed";
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const id of regionIds) {
      const latest = await ctx.db.query("nrtDayTotals").withIndex("by_region_day", (q) => q.eq("region", id)).order("desc").first();
      const lastRun = await ctx.db.query("runs").withIndex("by_region_started", (q) => q.eq("region", id)).order("desc").first();
      out.push({
        region: id,
        bundleEnd: REGIONS[id].bundleEnd,
        latestDay: latest?.day ?? null,
        lastRun: lastRun ? { at: lastRun.finishedAt, ok: lastRun.ok, from: lastRun.from ?? null, to: lastRun.to ?? null, days: lastRun.days, error: errorClass(lastRun.error) } : null,
      });
    }
    return out;
  },
});

/** Whole-region NRT totals for days strictly after `after` (normally the bundle's planEnd). */
export const dayTotals = query({
  args: { region: v.string(), after: v.string() },
  handler: async (ctx, { region, after }) => {
    checkRegion(region);
    if (!isDate(after)) throw Error("after must be YYYY-MM-DD");
    const docs = await ctx.db.query("nrtDayTotals").withIndex("by_region_day", (q) => q.eq("region", region).gt("day", after)).take(MAX_TOTAL_DAYS);
    return docs.map((d) => ({ day: d.day, total: d.total, fineCellDays: d.fineCellDays, detections: d.detections, sources: d.sources, fetchedAt: d.fetchedAt, provisional: provisional(d.day, d.fetchedAt) }));
  },
});

/** res-5 cell partitions (JSON V2Partition) for up to 16 listed days. */
export const dayCells = query({
  args: { region: v.string(), days: v.array(v.string()) },
  handler: async (ctx, { region, days }) => {
    checkRegion(region);
    if (days.length > MAX_CELL_DAYS) throw Error(`at most ${MAX_CELL_DAYS} days per call`);
    if (!days.every(isDate)) throw Error("days must be YYYY-MM-DD");
    const out = [];
    for (const day of days) {
      const d = await ctx.db.query("nrtDayCells").withIndex("by_region_day", (q) => q.eq("region", region).eq("day", day)).unique();
      if (d) out.push({ day, partition: d.partition });
    }
    return out;
  },
});
