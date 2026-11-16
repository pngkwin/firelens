// FIRMS transaction budget. The area API allows 5,000 transactions per 10
// minutes per MAP_KEY, shared with the local ingest scripts, so Convex keeps
// its own conservative share and records every reservation.
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const WINDOW_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const HOUR_MS = 3_600_000;

/**
 * Reserve `tx` transactions or report when to retry. Atomic (one mutation).
 *
 * Exports are public, so they get limits the pull does not:
 * - at most EXPORT_TX_PER_10MIN (default 1,000) of the 10-minute budget, so
 *   the daily pull always keeps the remainder (default 500; a pull needs 72);
 * - at most EXPORT_TX_PER_CLIENT_HOUR (default 1,000) per client per hour,
 *   keyed by a hash of the client address (`client`), so one script cannot
 *   use the whole daily export budget;
 * - at most EXPORT_TX_PER_DAY (default 10,000) per day in total.
 */
export const reserve = internalMutation({
  args: { tx: v.number(), purpose: v.union(v.literal("pull"), v.literal("export")), client: v.optional(v.string()) },
  handler: async (ctx, { tx, purpose, client }) => {
    const now = Date.now();
    const per10 = envInt("FIRMS_TX_PER_10MIN", 1500);
    const exportPer10 = Math.min(per10, envInt("EXPORT_TX_PER_10MIN", 1000));
    const exportPerDay = envInt("EXPORT_TX_PER_DAY", 10_000);
    const perClientHour = envInt("EXPORT_TX_PER_CLIENT_HOUR", 1000);
    const recent = await ctx.db.query("firmsLedger").withIndex("by_at", (q) => q.gt("at", now - DAY_MS)).collect();
    const in10 = recent.filter((r) => r.at > now - WINDOW_MS);
    const retry10 = (rows: typeof recent) => { const oldest = [...rows].sort((a, b) => a.at - b.at)[0]; return oldest ? oldest.at + WINDOW_MS - now : WINDOW_MS; };
    const used10 = in10.reduce((s, r) => s + r.tx, 0);
    if (used10 + tx > per10) return { ok: false as const, reason: `FIRMS budget: ${used10}/${per10} transactions used in the last 10 minutes`, retryAfterMs: retry10(in10) };
    if (purpose === "export") {
      const exports10 = in10.filter((r) => r.purpose === "export");
      const usedExport10 = exports10.reduce((s, r) => s + r.tx, 0);
      if (usedExport10 + tx > exportPer10) return { ok: false as const, reason: `export budget: ${usedExport10}/${exportPer10} transactions used in the last 10 minutes`, retryAfterMs: retry10(exports10) };
      if (client) {
        const mine = recent.filter((r) => r.purpose === "export" && r.client === client && r.at > now - HOUR_MS);
        const usedMine = mine.reduce((s, r) => s + r.tx, 0);
        if (usedMine + tx > perClientHour) {
          const oldest = [...mine].sort((a, b) => a.at - b.at)[0];
          return { ok: false as const, reason: `export limit for this client: ${usedMine}/${perClientHour} transactions in the last hour`, retryAfterMs: oldest ? oldest.at + HOUR_MS - now : HOUR_MS };
        }
      }
      const usedDay = recent.filter((r) => r.purpose === "export").reduce((s, r) => s + r.tx, 0);
      if (usedDay + tx > exportPerDay) return { ok: false as const, reason: `daily export budget reached (${usedDay}/${exportPerDay} transactions)`, retryAfterMs: DAY_MS };
    }
    await ctx.db.insert("firmsLedger", { at: now, tx, purpose, ...(client ? { client } : {}) });
    // Housekeeping: drop entries older than a day.
    for (const old of await ctx.db.query("firmsLedger").withIndex("by_at", (q) => q.lt("at", now - DAY_MS)).take(200)) await ctx.db.delete(old._id);
    return { ok: true as const, used10: used10 + tx, per10 };
  },
});
