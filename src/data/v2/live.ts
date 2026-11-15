// Live near-real-time layer from the Convex backend (convex/live.ts).
//
// The static v2 bundle is authoritative through its manifest planEnd; Convex
// only ever contributes days strictly after it, so a day can never be counted
// from both. Everything degrades to "static only" when VITE_CONVEX_URL is not
// configured or the backend is unreachable.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { V2Partition, WireRow } from "./codec";

export type LiveDay = { day: string; total: WireRow; fineCellDays: number; detections: number; sources: string[]; fetchedAt: number; provisional: boolean };
export type LiveStatus = { configured: boolean; error?: string };

const url = (import.meta.env?.VITE_CONVEX_URL as string | undefined) ?? undefined;
const siteUrl = (import.meta.env?.VITE_CONVEX_SITE_URL as string | undefined) ?? undefined;
let client: ConvexHttpClient | null = null;
const getClient = () => (url ? (client ??= new ConvexHttpClient(url)) : null);

export const liveConfigured = () => Boolean(url);

/** Keep only live days after the bundle end, sorted, one per day. */
export function stitchLive(bundleEnd: string, days: LiveDay[]): LiveDay[] {
  const byDay = new Map<string, LiveDay>();
  for (const d of days) if (d.day > bundleEnd) byDay.set(d.day, d);
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export async function loadLiveTotals(region: string, bundleEnd: string): Promise<{ days: LiveDay[]; status: LiveStatus }> {
  const c = getClient();
  if (!c) return { days: [], status: { configured: false } };
  try {
    const rows = await c.query(api.live.dayTotals, { region, after: bundleEnd });
    const days = rows.map((r) => ({ ...r, total: JSON.parse(r.total) as WireRow }));
    return { days: stitchLive(bundleEnd, days), status: { configured: true } };
  } catch (e) {
    return { days: [], status: { configured: true, error: e instanceof Error ? e.message : String(e) } };
  }
}

/** res-5 cell partitions for live days (for AOI queries), fetched 16 days per call. */
export async function loadLiveCells(region: string, days: string[]): Promise<Array<{ day: string; partition: V2Partition }>> {
  const c = getClient();
  if (!c) return [];
  const out: Array<{ day: string; partition: V2Partition }> = [];
  for (let i = 0; i < days.length; i += 16) {
    const rows = await c.query(api.live.dayCells, { region, days: days.slice(i, i + 16) });
    for (const r of rows) out.push({ day: r.day, partition: JSON.parse(r.partition) as V2Partition });
  }
  return out;
}

export const EXPORT_MAX_DAYS = 31;
export const EXPORT_MAX_ROWS = 50_000;

/** URL of the capped point-CSV export, or null when no backend is configured. */
export function hotspotsCsvUrl(p: { bbox: [number, number, number, number]; start: string; end: string; sensors?: Array<"modis" | "viirs"> }, base: string | null | undefined = siteUrl): string | null {
  if (!base) return null;
  const q = new URLSearchParams({ bbox: p.bbox.map((x) => x.toFixed(4)).join(","), start: p.start, end: p.end });
  if (p.sensors?.length) q.set("sensors", p.sensors.join(","));
  return `${base.replace(/\/$/, "")}/hotspots.csv?${q}`;
}
