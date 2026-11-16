// GET /hotspots.csv?bbox=w,s,e,n&start=YYYY-MM-DD[&end=YYYY-MM-DD][&sensors=modis,viirs]
//
// Streams raw FIRMS detections (science-quality where available, NRT after)
// for a bounding box through to a CSV. Nothing is stored. Caps: 31 days,
// 50,000 rows, and a shared FIRMS transaction budget (convex/ledger.ts).
// Rows are FIRMS records as published: not region-clipped, not static-masked.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { SOURCES } from "./regions";
import { parseExportParams, planRange, txCost, countLines, exportCsvText, CSV_HEADER, redact, EXPORT_LIMITS, type Availability } from "./lib/nrtCore";
import { firmsKey, fetchAvailability, forEachText } from "./firms";

const cors = (req: Request): Record<string, string> => {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
  const origin = req.headers.get("Origin") ?? "";
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Expose-Headers": "X-FireLens-Rows, X-FireLens-Sources, X-FireLens-Transactions", Vary: "Origin" };
};
const json = (req: Request, status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req), ...extra } });

/**
 * Stable, non-reversible id for the caller, for the per-client export limit.
 * Uses the first X-Forwarded-For address (set by Convex's edge); only a
 * SHA-256 hash is stored, never the address.
 */
export async function clientId(req: Request): Promise<string> {
  const addr = (req.headers.get("X-Forwarded-For") ?? req.headers.get("X-Real-IP") ?? "unknown").split(",")[0].trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`firelens-export:${addr}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const exportCsv = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const parsed = parseExportParams(url.searchParams, today);
  if (!parsed.ok) return json(req, 400, { error: parsed.error, limits: EXPORT_LIMITS });
  const { bbox, start, end, sensors } = parsed.params;
  let key: string | undefined;
  try {
    key = firmsKey();
    const cached = await ctx.runQuery(internal.ingest.getMeta, { key: "availability" });
    let availability: Availability = cached ? JSON.parse(cached) : await fetchAvailability(key);
    // Refresh if the request reaches past what the cached availability knows.
    if (cached && !Object.values(availability).some((a) => a.max >= end)) availability = await fetchAvailability(key);
    const jobs = planRange({ sources: SOURCES, availability, boxes: [{ id: "bbox", bbox }], from: start, to: end, sensors, size: 1 }); // 1-day windows keep each response small (same transaction cost)
    const tx = txCost(jobs);
    if (tx) {
      const budget = await ctx.runMutation(internal.ledger.reserve, { tx, purpose: "export", client: await clientId(req) });
      if (!budget.ok) return json(req, 429, { error: budget.reason }, { "Retry-After": String(Math.ceil(budget.retryAfterMs / 1000)) });
    }
    // The default runtime has 64 MB: count each response before converting it,
    // stop at the row cap, and build the CSV line by line.
    let rows = 0;
    const chunks: string[] = [CSV_HEADER];
    const complete = await forEachText(key, jobs, (job, text) => {
      rows += countLines(text);
      if (rows > EXPORT_LIMITS.maxRows) return false;
      chunks.push(exportCsvText(job.source, text));
    });
    if (!complete) return json(req, 413, { error: `more than ${EXPORT_LIMITS.maxRows} detections; narrow the area or date range`, limits: EXPORT_LIMITS });
    const name = `firelens-hotspots_${bbox.join("_")}_${start}_${end}.csv`;
    return new Response(chunks.join(""), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-FireLens-Rows": String(rows),
        "X-FireLens-Sources": [...new Set(jobs.map((j) => j.source))].join(","),
        "X-FireLens-Transactions": String(tx),
        ...cors(req),
      },
    });
  } catch (e) {
    return json(req, 502, { error: redact(e instanceof Error ? e.message : String(e), key).slice(0, 300) });
  }
});

const http = httpRouter();
http.route({ path: "/hotspots.csv", method: "GET", handler: exportCsv });
http.route({ path: "/hotspots.csv", method: "OPTIONS", handler: httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: cors(req) })) });
export default http;
