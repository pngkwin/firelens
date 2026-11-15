// Internal queries and mutations behind the NRT pull (convex/pull.ts).
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const latestDay = internalQuery({
  args: { region: v.string() },
  handler: async (ctx, { region }) => (await ctx.db.query("nrtDayTotals").withIndex("by_region_day", (q) => q.eq("region", region)).order("desc").first())?.day ?? null,
});

export const getMeta = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => (await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", key)).unique())?.value ?? null,
});

export const setMeta = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const doc = await ctx.db.query("meta").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (doc) await ctx.db.patch(doc._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("meta", { key, value, updatedAt: Date.now() });
  },
});

/** Replace one region-day (totals + cells) atomically. */
export const writeDay = internalMutation({
  args: { region: v.string(), day: v.string(), total: v.string(), partition: v.string(), fineCellDays: v.number(), detections: v.number(), sources: v.array(v.string()), fetchedAt: v.number() },
  handler: async (ctx, a) => {
    const t = await ctx.db.query("nrtDayTotals").withIndex("by_region_day", (q) => q.eq("region", a.region).eq("day", a.day)).unique();
    const totals = { region: a.region, day: a.day, total: a.total, fineCellDays: a.fineCellDays, detections: a.detections, sources: a.sources, fetchedAt: a.fetchedAt };
    if (t) await ctx.db.replace(t._id, totals);
    else await ctx.db.insert("nrtDayTotals", totals);
    const c = await ctx.db.query("nrtDayCells").withIndex("by_region_day", (q) => q.eq("region", a.region).eq("day", a.day)).unique();
    const cells = { region: a.region, day: a.day, partition: a.partition, bytes: a.partition.length };
    if (c) await ctx.db.replace(c._id, cells);
    else await ctx.db.insert("nrtDayCells", cells);
  },
});

/** Drop days now covered by the static bundle. */
export const prune = internalMutation({
  args: { region: v.string(), through: v.string() },
  handler: async (ctx, { region, through }) => {
    for (const table of ["nrtDayTotals", "nrtDayCells"] as const)
      for (const d of await ctx.db.query(table).withIndex("by_region_day", (q) => q.eq("region", region).lte("day", through)).take(500)) await ctx.db.delete(d._id);
  },
});

export const recordRun = internalMutation({
  args: { region: v.string(), startedAt: v.number(), finishedAt: v.number(), ok: v.boolean(), from: v.optional(v.string()), to: v.optional(v.string()), days: v.number(), detections: v.number(), tx: v.number(), error: v.optional(v.string()), stats: v.optional(v.string()) },
  handler: async (ctx, run) => {
    await ctx.db.insert("runs", run);
  },
});

