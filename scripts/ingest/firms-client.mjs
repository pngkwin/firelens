// Minimal FIRMS API client. The MAP_KEY is read from .env.local (or the
// FIRMS_MAP_KEY environment variable) and is never logged: every error message
// and URL that might be printed passes through redact().
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://firms.modaps.eosdis.nasa.gov";
// FIRMS keys are 32 hexadecimal characters; any standalone token of that shape is redacted too.
const KEY_LIKE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi;
export const redactKey = (s, key) => String(s ?? "").split(key).join("<MAP_KEY>").replace(KEY_LIKE, "<MAP_KEY>");

function checkKey(key) {
  if (!/^[0-9a-f]{32}$/i.test(key)) throw Error("FIRMS_MAP_KEY is not 32 hexadecimal characters (the value is not printed).");
  return key;
}

export function loadKey(root = process.cwd()) {
  if (process.env.FIRMS_MAP_KEY) return checkKey(process.env.FIRMS_MAP_KEY.trim());
  const file = resolve(root, ".env.local");
  if (!existsSync(file))
    throw Error("FIRMS_MAP_KEY missing: add it to .env.local (gitignored).");
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*FIRMS_MAP_KEY\s*=/.test(l));
  const key = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  if (!key) throw Error("FIRMS_MAP_KEY is empty in .env.local.");
  return checkKey(key);
}

export function makeClient(key, { timeoutMs = 120_000 } = {}) {
  const redact = (s) => redactKey(s, key);
  async function get(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(BASE + path, { signal: ctrl.signal });
      const text = await res.text();
      return { status: res.status, text };
    } catch (e) {
      throw Error(redact(e?.message ?? e));
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    redact,
    async status() {
      const r = await get(`/mapserver/mapkey_status/?MAP_KEY=${key}`);
      if (r.status !== 200) throw Error(`mapkey_status HTTP ${r.status}`);
      return JSON.parse(r.text);
    },
    async availability() {
      const r = await get(`/api/data_availability/csv/${key}/ALL`);
      if (r.status !== 200) throw Error(`data_availability HTTP ${r.status}`);
      return Object.fromEntries(
        r.text
          .trim()
          .split(/\r?\n/)
          .slice(1)
          .map((l) => l.split(","))
          .map(([id, min, max]) => [id, { min, max }]),
      );
    },
    /** dayRange 1..5 days starting at `date` (YYYY-MM-DD). bbox = [w,s,e,n]. */
    async area(source, bbox, dayRange, date) {
      const r = await get(
        `/api/area/csv/${key}/${source}/${bbox.join(",")}/${dayRange}/${date}`,
      );
      return { status: r.status, text: redact(r.text) };
    },
  };
}
