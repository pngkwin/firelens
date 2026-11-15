"use node";
// Scheduled near-real-time pull (Node runtime: 512 MB, enough for a peak
// fire-season US window). For each region it fetches MODIS and VIIRS NRT
// detections for the days after the static v2 bundle ends, aggregates them to
// fire-cell-day histograms exactly as the offline pipeline does
// (convex/lib/nrtCore.test.ts proves equality on a real day), and stores one
// aggregate document per region-day. Raw points are never stored.
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { REGIONS, NRT_SOURCES, regionIds } from "./regions";
import { dayAggregator, planRange, pullRange, shiftDay, txCost, redact } from "./lib/nrtCore";
import { firmsKey, fetchAvailability, forEachText } from "./firms";

const REFRESH_DAYS = 3;
const MAX_DAYS_PER_RUN = 30;

export const pullAll = internalAction({
  args: {},
  handler: async (ctx) => {
    // Regions run one after another; a failure in one does not stop the next.
    const failed: string[] = [];
    for (const region of regionIds) {
      try {
        await ctx.runAction(internal.pull.pullRegion, { region });
      } catch {
        failed.push(region);
      }
    }
    if (failed.length) throw Error(`pull failed for ${failed.join(", ")} (see runs table)`);
  },
});

export const pullRegion = internalAction({
  args: { region: v.string(), refreshDays: v.optional(v.number()) },
  handler: async (ctx, { region: regionId, refreshDays = REFRESH_DAYS }) => {
    const region = REGIONS[regionId];
    if (!region) throw Error(`unknown region ${regionId}`);
    const run: { region: string; startedAt: number; days: number; detections: number; tx: number; from?: string; to?: string } = { region: regionId, startedAt: Date.now(), days: 0, detections: 0, tx: 0 };
    let key: string | undefined;
    try {
      key = firmsKey();
      const availability = await fetchAvailability(key);
      await ctx.runMutation(internal.ingest.setMeta, { key: "availability", value: JSON.stringify(availability) });

      const latest = await ctx.runQuery(internal.ingest.latestDay, { region: regionId });
      const range = pullRange({ bundleEnd: region.bundleEnd, latest, today: new Date().toISOString().slice(0, 10), refreshDays, maxDays: MAX_DAYS_PER_RUN });
      if (!range) {
        await ctx.runMutation(internal.ingest.recordRun, { ...run, finishedAt: Date.now(), ok: true });
        return;
      }
      const { from, to } = range;
      Object.assign(run, range);

      const jobs = planRange({ sources: NRT_SOURCES, availability, boxes: region.boxes, from, to });
      run.tx = txCost(jobs);
      const budget = await ctx.runMutation(internal.ledger.reserve, { tx: run.tx, purpose: "pull" });
      if (!budget.ok) throw Error(budget.reason);
      // All-or-nothing: a failed window throws before anything is written.
      const agg = dayAggregator(region, from, to);
      await forEachText(key, jobs, (job, text) => agg.addCsv(job.source, text));
      const { days, stats } = agg.finish();

      const fetchedAt = Date.now();
      for (const d of days) {
        const sources = [...new Set(jobs.filter((j) => j.date <= d.day && d.day <= shiftDay(j.date, j.days - 1)).map((j) => j.source))].sort();
        const detections = d.total[5].reduce((s, x) => s + x, 0);
        await ctx.runMutation(internal.ingest.writeDay, { region: regionId, day: d.day, total: JSON.stringify(d.total), partition: JSON.stringify(d.partition), fineCellDays: d.fineCellDays, detections, sources, fetchedAt });
        run.detections += detections;
      }
      run.days = days.length;
      await ctx.runMutation(internal.ingest.prune, { region: regionId, through: region.bundleEnd });
      await ctx.runMutation(internal.ingest.recordRun, { ...run, finishedAt: Date.now(), ok: true, stats: JSON.stringify(stats) });
    } catch (e) {
      const error = redact(e instanceof Error ? e.message : String(e), key).slice(0, 500);
      await ctx.runMutation(internal.ingest.recordRun, { ...run, finishedAt: Date.now(), ok: false, error });
      throw Error(error);
    }
  },
});
