// FIRMS HTTP helpers for Convex actions. The MAP_KEY comes only from the
// FIRMS_MAP_KEY deployment environment variable; every error string passes
// through redact() before it can reach a log, a table or a response.
import { FIRMS_BASE, areaPath, csvHeader, redact, type Availability, type Job } from "./lib/nrtCore";

export function firmsKey(): string {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) throw Error("FIRMS_MAP_KEY is not set on this Convex deployment");
  return key;
}

async function get(url: string, key: string, timeoutMs = 90_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    if (res.status !== 200) throw Error(`FIRMS HTTP ${res.status}: ${text.slice(0, 200)}`);
    return text;
  } catch (e) {
    throw Error(redact(e instanceof Error ? e.message : String(e), key));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAvailability(key: string): Promise<Availability> {
  const text = await get(`${FIRMS_BASE}/api/data_availability/csv/${key}/ALL`, key);
  const lines = text.trim().split(/\r?\n/);
  const rows = lines.slice(1).map((l) => l.split(","));
  if (!rows.length || rows.some((r) => r.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(r[1]) || !/^\d{4}-\d{2}-\d{2}$/.test(r[2])))
    throw Error(redact(`Unexpected data_availability response: ${lines[0]?.slice(0, 120)}`, key));
  return Object.fromEntries(rows.map(([id, min, max]) => [id, { min, max }]));
}

/** Fetch one area window with retries; returns validated CSV text. */
export async function fetchText(key: string, job: Job, attempts = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = await get(FIRMS_BASE + areaPath(key, job), key);
      csvHeader(text); // throws on non-table responses (key errors, HTML)
      return text;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw Error(redact(`${job.source} ${job.box} ${job.date}+${job.days}: ${last instanceof Error ? last.message : String(last)}`, key));
}

/**
 * Fetch jobs with bounded concurrency and hand each response to `onText` in
 * job order, so at most `concurrency` responses are held at once. `onText`
 * may return false to stop early.
 */
export async function forEachText(key: string, jobs: Job[], onText: (job: Job, text: string) => boolean | void, concurrency = 3) {
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const texts = await Promise.all(batch.map((j) => fetchText(key, j)));
    for (const [k, text] of texts.entries()) if (onText(batch[k], text) === false) return false;
  }
  return true;
}
