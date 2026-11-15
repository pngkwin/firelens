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

/** Reserve `tx` transactions or report when to retry. Atomic (one mutation). */
export const reserve = internalMutation({
  args: { tx: v.number(), purpose: v.union(v.literal("pull"), v.literal("export")) },
  handler: async (ctx, { tx, purpose }) => {
    const now = Date.now();
    const per10 = envInt("FIRMS_TX_PER_10MIN", 1500);
    const exportPerDay = envInt("EXPORT_TX_PER_DAY", 10_000);
    const recent = await ctx.db.query("firmsLedger").withIndex("by_at", (q) => q.gt("at", now - DAY_MS)).collect();
    const used10 = recent.filter((r) => r.at > now - WINDOW_MS).reduce((s, r) => s + r.tx, 0);
    if (used10 + tx > per10) {
      const oldest = recent.filter((r) => r.at > now - WINDOW_MS).sort((a, b) => a.at - b.at)[0];
      return { ok: false as const, reason: `FIRMS budget: ${used10}/${per10} transactions used in the last 10 minutes`, retryAfterMs: oldest ? oldest.at + WINDOW_MS - now : WINDOW_MS };
    }
    if (purpose === "export") {
      const usedDay = recent.filter((r) => r.purpose === "export").reduce((s, r) => s + r.tx, 0);
      if (usedDay + tx > exportPerDay) return { ok: false as const, reason: `daily export budget reached (${usedDay}/${exportPerDay} transactions)`, retryAfterMs: DAY_MS };
    }
    await ctx.db.insert("firmsLedger", { at: now, tx, purpose });
    // Housekeeping: drop entries older than a day.
    for (const old of await ctx.db.query("firmsLedger").withIndex("by_at", (q) => q.lt("at", now - DAY_MS)).take(200)) await ctx.db.delete(old._id);
    return { ok: true as const, used10: used10 + tx, per10 };
  },
});
