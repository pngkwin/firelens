// Pure logic shared by the Convex NRT pull and CSV export. No Convex imports,
// so it is unit-tested directly with vitest.
//
// Aggregation reuses the offline pipeline's core (scripts/ingest/aggregate-core
// and src/data/v2/codec), so a day aggregated here is bit-identical to the
// same day aggregated by scripts/ingest/aggregate.mjs + publish.mjs, given the
// same input rows.
import { cellToParent } from "h3-js";
import { CellDayAccumulator, platformOf } from "../../scripts/ingest/aggregate-core.mjs";
import { sourceSpans, windows, addDays } from "../../scripts/ingest/plan.mjs";
import { encodeHist, PLATFORMS, sumRows, fromWire, type WireRow, type V2Partition } from "../../src/data/v2/codec";

export const COARSE_RES = 5;
export const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov";
export type Availability = Record<string, { min: string; max: string }>;
export type SourceConfig = { id: string; sensor: "MODIS" | "VIIRS"; platform?: string; kind: "SP" | "NRT"; after?: string; endOfProduction?: string };
export type Box = { id: string; bbox: [number, number, number, number] };
export type RegionData = {
  id: string;
  name: string;
  boxes: Box[];
  clip: { res: number; cells: number; compact: string[] };
  staticCells: string[];
  bundleEnd: string;
};
export type Job = { source: string; box: string; bbox: number[]; date: string; days: number };

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const shiftDay = (d: string, n: number): string => addDays(d, n);
export const dayCount = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
export const txCost = (jobs: Job[]) => jobs.reduce((s, j) => s + 2 * j.days, 0);

/** Membership test against a losslessly compacted H3 cell set. */
export function makeCompactClip(compact: string[], res: number) {
  const set = new Set(compact);
  const resolutions = [...new Set(compact.map((c) => parseInt(c[1], 16)))].sort((a, b) => b - a);
  return (cell8: string) => {
    for (const r of resolutions) if (r <= res && set.has(cellToParent(cell8, r))) return true;
    return false;
  };
}

/**
 * Jobs to fetch every source that covers [from, to] in each box, using the
 * same SP-before-NRT stitch rule as the offline plan (scripts/ingest/plan.mjs).
 * `sensors` limits the families (MODIS and/or VIIRS).
 */
export function planRange(opts: { sources: SourceConfig[]; availability: Availability; boxes: Box[]; from: string; to: string; sensors?: Array<"MODIS" | "VIIRS">; size?: number }): Job[] {
  const { sources, availability, boxes, from, to, sensors, size = 5 } = opts;
  const wanted = sources.filter((s) => !sensors || sensors.includes(s.sensor));
  const jobs: Job[] = [];
  for (const span of sourceSpans(wanted, availability, to) as Array<{ id: string; start: string; end: string }>) {
    const start = span.start > from ? span.start : from;
    if (start > span.end) continue;
    for (const box of boxes)
      for (const w of windows(start, span.end, size) as Array<{ date: string; days: number }>)
        jobs.push({ source: span.id, box: box.id, bbox: box.bbox, date: w.date, days: w.days });
  }
  return jobs;
}

export const areaPath = (key: string, j: Job) => `/api/area/csv/${key}/${j.source}/${j.bbox.join(",")}/${j.days}/${j.date}`;

/** Parse a FIRMS CSV response; throws on anything that is not a detection table. */
export function parseFirmsCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = (lines[0] ?? "").split(",");
  for (const col of ["latitude", "longitude", "acq_date", "satellite", "daynight"])
    if (!header.includes(col)) throw Error(`Unexpected FIRMS response (no ${col} column): ${(lines[0] ?? "").slice(0, 120)}`);
  return { header, rows: lines.slice(1).map((l) => l.split(",")) };
}

export type DayAggregate = {
  day: string;
  partition: V2Partition; // res-5 cells, one period
  total: WireRow; // whole-region total, cell index -1
  fineCellDays: number;
};

/** Region-clipped, static-masked fire-cell-day aggregation of FIRMS rows for [from, to]. */
export function aggregateDays(opts: { region: RegionData; from: string; to: string; tables: Array<{ source: string; header: string[]; rows: string[][] }> }) {
  const agg = dayAggregator(opts.region, opts.from, opts.to);
  for (const t of opts.tables) agg.addRows(t.source, t.header, t.rows);
  return agg.finish();
}

/**
 * Incremental form: add FIRMS CSV text one window at a time so only one
 * response is held in memory, then finish() once.
 */
export function dayAggregator(region: RegionData, from: string, to: string) {
  const inRegion = makeCompactClip(region.clip.compact, region.clip.res);
  const acc = new CellDayAccumulator({ staticCells: new Set(region.staticCells), start: from, end: to, inRegion });
  const detectionsBySource: Record<string, number> = {};
  const addRows = (source: string, header: string[], rows: Iterable<string[]>) => {
    const idx = Object.fromEntries(header.map((k, i) => [k, i]));
    for (const f of rows) {
      const before = acc.accepted;
      acc.add({ latitude: f[idx.latitude], longitude: f[idx.longitude], acq_date: f[idx.acq_date], satellite: f[idx.satellite], daynight: f[idx.daynight], frp: f[idx.frp] });
      if (acc.accepted > before) detectionsBySource[source] = (detectionsBySource[source] ?? 0) + 1;
    }
  };
  return {
    addRows,
    addCsv: (source: string, text: string) => {
      const header = csvHeader(text);
      addRows(source, header, csvLines(text));
    },
    finish: () => finishDays(acc, region, from, to, detectionsBySource),
  };
}

/** Validated header of a FIRMS CSV response. */
export function csvHeader(text: string): string[] {
  const end = text.indexOf("\n");
  const raw = end < 0 ? text : text.slice(0, end);
  const line = raw.replace(/\r$/, "");
  return parseFirmsCsv(line).header;
}
/** Data lines of a CSV response, split lazily (one line in memory at a time). */
export function* csvLines(text: string): Generator<string[]> {
  let i = text.indexOf("\n") + 1;
  if (i <= 0) return;
  while (i < text.length) {
    let j = text.indexOf("\n", i);
    if (j < 0) j = text.length;
    const line = text.slice(i, text[j - 1] === "\r" ? j - 1 : j);
    if (line) yield line.split(",");
    i = j + 1;
  }
}
/** Number of data lines (no allocation per line). */
export function countLines(text: string): number {
  let n = 0;
  for (const _ of lineEnds(text)) n++;
  return Math.max(0, n - 1);
}
function* lineEnds(text: string) {
  let i = 0;
  while (i < text.length) {
    let j = text.indexOf("\n", i);
    if (j < 0) j = text.length;
    if (j > i && !(j === i + 1 && text[i] === "\r")) yield j;
    i = j + 1;
  }
}

function finishDays(acc: CellDayAccumulator, region: RegionData, from: string, to: string, detectionsBySource: Record<string, number>) {
  const coarse = acc.coarse(COARSE_RES, "day") as Array<{ cell: string; period: string; any: Record<string, number>; day: Record<string, number>; night: Record<string, number>; det: Record<string, number>; frp: Record<string, number> }>;
  const fine = new Map<string, number>();
  for (const key of acc.cells.keys() as Iterable<string>) {
    const d = key.split("|")[1];
    fine.set(d, (fine.get(d) ?? 0) + 1);
  }
  const days: DayAggregate[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) {
    const rows = coarse.filter((r) => r.period === d);
    const cells = rows.map((r) => r.cell);
    const wire: WireRow[] = rows.map((r, i) => toWire(r, i, 0));
    const total = sumRows(wire.map(fromWire));
    days.push({
      day: d,
      partition: { v: 2, region: region.id, kind: "daily", res: COARSE_RES, shard: "region-nrt", periods: [d], cells, rows: wire },
      total: [-1, 0, total.day, total.night, total.any, total.det, total.frp.map((v) => Math.round(v * 10) / 10)],
      fineCellDays: fine.get(d) ?? 0,
    });
  }
  return { days, stats: { accepted: acc.accepted as number, excludedStatic: acc.excludedStatic as number, outsideRegion: acc.outsideRegion as number, rejected: acc.rejected as number, detectionsBySource } };
}

// Identical to publish.mjs toWire.
function toWire(r: { day: Record<string, number>; night: Record<string, number>; any: Record<string, number>; det: Record<string, number>; frp: Record<string, number> }, cellIdx: number, periodIdx: number): WireRow {
  return [cellIdx, periodIdx, encodeHist(r.day), encodeHist(r.night), encodeHist(r.any), PLATFORMS.map((p) => r.det[p] ?? 0), PLATFORMS.map((p) => Math.round((r.frp[p] ?? 0) * 10) / 10)];
}

// ---- point CSV export ----------------------------------------------------------

export const EXPORT_LIMITS = { maxDays: 31, maxRows: 50_000, firstDay: "2000-11-01" } as const;
export type ExportParams = { bbox: [number, number, number, number]; start: string; end: string; sensors: Array<"MODIS" | "VIIRS"> };

/** Validate export query parameters. Returns params or a user-facing error. */
export function parseExportParams(q: URLSearchParams, today: string): { ok: true; params: ExportParams } | { ok: false; error: string } {
  const bboxRaw = q.get("bbox");
  if (!bboxRaw) return { ok: false, error: "bbox=west,south,east,north is required" };
  const bbox = bboxRaw.split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((x) => !Number.isFinite(x))) return { ok: false, error: "bbox must be four numbers: west,south,east,north" };
  const [w, s, e, n] = bbox;
  if (w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return { ok: false, error: "bbox out of range or empty (west < east, south < north; split boxes that cross the antimeridian)" };
  const start = q.get("start"), end = q.get("end") ?? start;
  if (!isDate(start) || !isDate(end)) return { ok: false, error: "start and end must be YYYY-MM-DD" };
  if (start > end) return { ok: false, error: "start must not be after end" };
  if (start < EXPORT_LIMITS.firstDay) return { ok: false, error: `start must be on or after ${EXPORT_LIMITS.firstDay}` };
  if (end > today) return { ok: false, error: `end must not be after today (${today} UTC)` };
  if (dayCount(start, end) > EXPORT_LIMITS.maxDays) return { ok: false, error: `at most ${EXPORT_LIMITS.maxDays} days per export` };
  const sensorsRaw = (q.get("sensors") ?? "modis,viirs").toUpperCase().split(",").filter(Boolean);
  if (!sensorsRaw.length || sensorsRaw.some((x) => x !== "MODIS" && x !== "VIIRS")) return { ok: false, error: "sensors must be modis, viirs or modis,viirs" };
  return { ok: true, params: { bbox: [w, s, e, n], start, end, sensors: [...new Set(sensorsRaw)] as Array<"MODIS" | "VIIRS"> } };
}

export const EXPORT_COLUMNS = ["source", "platform", "instrument", "latitude", "longitude", "acq_date", "acq_time", "daynight", "confidence", "frp", "bright_mir_k", "bright_tir_k", "scan", "track", "version", "type"] as const;

/** Map one FIRMS row (MODIS or VIIRS schema, SP or NRT) to the common export schema. */
export function exportRow(source: string, header: string[], f: string[]): string[] {
  const get = (k: string) => { const i = header.indexOf(k); return i < 0 ? "" : (f[i] ?? ""); };
  const viirs = source.startsWith("VIIRS");
  return [
    source,
    platformOf(get("satellite")),
    viirs ? "VIIRS" : "MODIS",
    get("latitude"), get("longitude"), get("acq_date"), get("acq_time"), get("daynight"), get("confidence"), get("frp"),
    viirs ? get("bright_ti4") : get("brightness"), // mid-IR brightness temperature (MODIS band 21/22, VIIRS I4), K
    viirs ? get("bright_ti5") : get("bright_t31"), // thermal-IR (MODIS band 31, VIIRS I5), K
    get("scan"), get("track"), get("version"), get("type"),
  ];
}

/**
 * Spreadsheet formula-injection guard: a non-numeric value starting with
 * = + - @ tab or CR gets a leading apostrophe. Numbers (including negative
 * longitudes such as -120.5) are left unchanged.
 */
export const guardFormula = (s: string) => (/^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s)) ? `'${s}` : s);
const csvCell = (raw: string) => {
  const v = guardFormula(raw);
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
};
export const toCsv = (rows: string[][]) => [EXPORT_COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";

/** FIRMS MAP_KEYs are 32 hexadecimal characters. */
export const MAP_KEY_FORMAT = /^[0-9a-f]{32}$/i;
/** A standalone 32-hex token (not part of a longer hex string such as a SHA-256). */
const KEY_LIKE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/gi;
/**
 * Remove the key from text that might reach a response, table or log: the exact
 * key in any letter case and, as a fallback, any key-shaped token.
 */
export const redact = (text: string, key: string | undefined) => {
  let s = String(text);
  if (key) {
    const lower = s.toLowerCase(), k = key.toLowerCase();
    let out = "", i = 0;
    for (let j = lower.indexOf(k); j >= 0 && k; j = lower.indexOf(k, i)) { out += s.slice(i, j) + "<MAP_KEY>"; i = j + k.length; }
    s = out + s.slice(i);
  }
  return s.replace(KEY_LIKE, "<MAP_KEY>");
};

export const CSV_HEADER = EXPORT_COLUMNS.join(",") + "\n";
/** One FIRMS response converted to export CSV lines (no header), line by line. */
export function exportCsvText(source: string, text: string): string {
  const header = csvHeader(text);
  let out = "";
  for (const f of csvLines(text)) out += exportRow(source, header, f).map(csvCell).join(",") + "\n";
  return out;
}

/**
 * Days a pull should (re)fetch: everything missing since the static bundle
 * ended or since the newest stored day, plus the last `refreshDays` days
 * (NRT keeps filling), never days the bundle covers, at most `maxDays`.
 * Returns null when there is nothing to fetch.
 */
export function pullRange(o: { bundleEnd: string; latest: string | null; today: string; refreshDays: number; maxDays: number }): { from: string; to: string } | null {
  const to = o.today;
  const firstMissing = shiftDay(o.latest && o.latest > o.bundleEnd ? o.latest : o.bundleEnd, 1);
  const refreshStart = shiftDay(to, -(o.refreshDays - 1));
  let from = firstMissing < refreshStart ? firstMissing : refreshStart;
  if (from <= o.bundleEnd) from = shiftDay(o.bundleEnd, 1);
  if (dayCount(from, to) > o.maxDays) from = shiftDay(to, -(o.maxDays - 1));
  return from > to ? null : { from, to };
}
