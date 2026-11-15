#!/usr/bin/env node
// Aggregate downloaded FIRMS windows into fire-cell-day histograms.
//
//   node scripts/ingest/aggregate.mjs --region us [--months 2024-01,2024-02] [--force]
//
// Reads data/raw/firms-api/<region>/**.csv.gz, writes ignored intermediates:
//   data/processed/agg/<region>/static-cells.json      static-source res-8 cells
//   data/processed/agg/<region>/monthly/<YYYY-MM>.json.gz  res-5 x month rows
//   data/processed/agg/<region>/daily/<YYYY-MM>.json.gz    res-5 x day rows
//   data/processed/agg/<region>/months.json            per-month status/tallies
// A month is aggregated only when every planned window overlapping it exists
// for every source with data in that month; others are reported "incomplete".
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { CellDayAccumulator, FINE_RES } from "./aggregate-core.mjs";
import { planJobs, addDays, windows } from "./plan.mjs";
import { makeClip } from "./clip.mjs";
import { latLngToCell } from "h3-js";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2).split("=")[0], a.split("=")[1] ?? (all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true)] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const config = JSON.parse(readFileSync(join(ROOT, "config/regions.json"), "utf8"));
const region = config.regions.find((r) => r.id === (args.region ?? "us"));
const RAW = join(ROOT, "data/raw/firms-api", region.id);
const OUT = join(ROOT, "data/processed/agg", region.id);
const COARSE_RES = 5;
for (const d of ["monthly", "daily"]) mkdirSync(join(OUT, d), { recursive: true });

const availability = JSON.parse(readFileSync(join(RAW, "availability.json"), "utf8"));
const END = args.end ?? JSON.parse(readFileSync(join(RAW, "plan-end.json"), "utf8")).end;
// Sourcing: science-quality (SP) sources come from verified FIRMS Archive
// Download windows when present (scripts/ingest/import-archive.mjs); NRT and
// any SP source without an archive come from API windows. Every row is then
// clipped to the region polygon, so footprints are identical across sources.
const ARCHW = join(ROOT, "data/raw/firms-archive", region.id, "windows");
const archive = existsSync(join(ARCHW, "manifest.json")) ? JSON.parse(readFileSync(join(ARCHW, "manifest.json"), "utf8")) : null;
let jobs = planJobs({ sources: config.sources, availability, region, end: END }).map((j) => ({ ...j, origin: "api" }));
if (archive) {
  for (const [source, a] of Object.entries(archive.sources)) {
    const sp = availability[source];
    if (!sp || a.start !== sp.min || a.end !== sp.max) throw Error(`archive span for ${source} (${a.start}..${a.end}) != planned SP span`);
    jobs = jobs.filter((j) => j.source !== source);
    for (const w of windows(a.start, a.end, 5)) jobs.push({ id: `${region.id}/${source}/country/${w.date}_${w.days}`, region: region.id, source, box: "country", origin: "archive", date: w.date, days: w.days });
  }
}
const windowFile = (j) => `${j.date}_${j.days}.csv.gz`;
const fileFor = (j) => j.origin === "archive" ? join(ARCHW, j.source, "country", j.date.slice(0, 4), windowFile(j)) : join(RAW, j.source, j.box, j.date.slice(0, 4), windowFile(j));
const clip = makeClip(region);
console.log(`sourcing: ${archive ? Object.keys(archive.sources).join(",") + " from archive" : "all from API"}; clip=${clip ? clip.cells.size + " res-7 cells" : "none"}`);
const lastDay = (j) => addDays(j.date, j.days - 1);

function readCsv(file) {
  const text = gunzipSync(readFileSync(file)).toString("utf8");
  const lines = text.split(/\r?\n/);
  const h = lines[0].split(",");
  const idx = Object.fromEntries(h.map((k, i) => [k, i]));
  return { lines, idx };
}
const writeAtomic = (file, buf) => { writeFileSync(file + ".tmp", buf); renameSync(file + ".tmp", file); };

// ---- pass 1: static-source mask from science-quality type codes ------------
const staticFile = join(OUT, "static-cells.json");
let staticCells;
const spJobs = jobs.filter((j) => j.source.endsWith("_SP") && existsSync(fileFor(j)));
if (existsSync(staticFile) && !args["rebuild-static"]) {
  const s = JSON.parse(readFileSync(staticFile, "utf8"));
  staticCells = new Set(s.cells);
  console.log(`static mask: ${staticCells.size} res-${FINE_RES} cells (cached from ${s.filesScanned} SP files)`);
} else {
  // Persistent non-vegetation cells: FIRMS type 1 (volcano), 2 (other static
  // land source, e.g. gas flares/industry) or 3 (offshore). A single type-2
  // label on an otherwise vegetated cell does not mask it (measured: 76% of
  // cells with any type 2/3 had only one such detection, holding ~5% of all
  // S-NPP vegetation detections).
  const MIN_STATIC = 3, MIN_SHARE = 0.5;
  const counts = new Map(); // cell -> [nonVegetation, other]
  for (const j of spJobs) {
    const { lines, idx } = readCsv(fileFor(j));
    if (idx.type === undefined) continue;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const f = lines[i].split(",");
      const t = f[idx.type];
      const c = latLngToCell(+f[idx.latitude], +f[idx.longitude], FINE_RES);
      let n = counts.get(c);
      if (!n) counts.set(c, (n = [0, 0]));
      if (t === "1" || t === "2" || t === "3") n[0]++;
      else n[1]++;
    }
  }
  staticCells = new Set([...counts].filter(([, [s, o]]) => s >= MIN_STATIC && s / (s + o) >= MIN_SHARE).map(([c]) => c));
  const anyStatic = [...counts.values()].filter(([s]) => s > 0).length;
  writeAtomic(staticFile, JSON.stringify({ rule: `res-8 cells with >= ${MIN_STATIC} science-quality detections of FIRMS type 1 (volcano), 2 (other static land source) or 3 (offshore), making up >= ${MIN_SHARE * 100}% of the cell's detections across all SP sources and years`, minStatic: MIN_STATIC, minShare: MIN_SHARE, cellsWithAnyNonVegetation: anyStatic, filesScanned: spJobs.length, cells: [...staticCells].sort() }));
  console.log(`static mask built: ${staticCells.size} cells (of ${anyStatic} with any type 1/2/3) from ${spJobs.length} SP files`);
}

// ---- pass 2: per-month aggregation ------------------------------------------
const months = new Set();
for (const j of jobs) {
  months.add(j.date.slice(0, 7));
  months.add(lastDay(j).slice(0, 7));
}
const statusFile = join(OUT, "months.json");
const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, "utf8")) : {};
const only = args.months ? new Set(String(args.months).split(",")) : null;
let processed = 0, incomplete = 0;
for (const month of [...months].sort()) {
  if (only && !only.has(month)) continue;
  const first = `${month}-01`, last = addDays(addDays(`${month}-01`, 32).slice(0, 7) + "-01", -1);
  const mine = jobs.filter((j) => j.date <= last && lastDay(j) >= first);
  const missing = mine.filter((j) => !existsSync(fileFor(j)));
  if (missing.length) {
    status[month] = { status: "incomplete", missingWindows: missing.length, windows: mine.length };
    incomplete++;
    continue;
  }
  if (status[month]?.status === "complete" && !args.force && existsSync(join(OUT, "monthly", `${month}.json.gz`))) continue;
  const acc = new CellDayAccumulator({ staticCells, start: first, end: last, inRegion: clip?.hasCell8 ?? null });
  const perSource = {};
  for (const j of mine) {
    const { lines, idx } = readCsv(fileFor(j));
    let n = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const f = lines[i].split(",");
      const d = f[idx.acq_date];
      if (d < first || d > last) continue;
      acc.add({ latitude: f[idx.latitude], longitude: f[idx.longitude], acq_date: d, satellite: f[idx.satellite], daynight: f[idx.daynight], frp: f[idx.frp] });
      n++;
    }
    perSource[j.source] = (perSource[j.source] ?? 0) + n;
  }
  const monthly = acc.coarse(COARSE_RES, "month");
  const daily = acc.coarse(COARSE_RES, "day");
  writeAtomic(join(OUT, "monthly", `${month}.json.gz`), gzipSync(JSON.stringify(monthly)));
  writeAtomic(join(OUT, "daily", `${month}.json.gz`), gzipSync(JSON.stringify(daily)));
  status[month] = { status: "complete", windows: mine.length, detectionsBySource: perSource, accepted: acc.accepted, excludedStatic: acc.excludedStatic, outsideRegion: acc.outsideRegion, rejected: acc.rejected, origins: [...new Set(mine.map((j) => j.origin))].sort(), fineCellDays: acc.cells.size, coarseMonthlyRows: monthly.length, coarseDailyRows: daily.length };
  processed++;
  writeAtomic(statusFile, JSON.stringify(status, null, 1));
  console.log(`${month}: detections=${acc.accepted} static=${acc.excludedStatic} cellDays=${acc.cells.size} res5Rows=${monthly.length} dailyRows=${daily.length}`);
}
writeAtomic(statusFile, JSON.stringify(status, null, 1));
console.log(`done: processed=${processed} incomplete=${incomplete}`);
