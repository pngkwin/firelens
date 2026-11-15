#!/usr/bin/env node
// Publish aggregated fire-cell-day data as a static, hash-verified v2 bundle.
//
//   node scripts/ingest/publish.mjs --region us [--allow-partial] [--out public/data/v2]
//
// Layout (public/data/v2/<region>/):
//   manifest.json                         sources, spans, month status, files+hashes
//   region-monthly.json.gz                whole-region totals per month
//   region-daily.json.gz                  whole-region totals per day
//   monthly/<res1>.json.gz                res-5 cells x months, one file per res-1 shard
//   daily/<res1>/<YYYY>.json.gz           res-5 cells x days, per shard and year
// All detections are clipped to the region boundary (res-7 cell centre in polygon).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { cellToParent } from "h3-js";
import { encodeHist, PLATFORMS, sumRows, fromWire } from "../../src/data/v2/codec.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2).split("=")[0], a.split("=")[1] ?? (all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true)] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const regionId = args.region ?? "us";
const config = JSON.parse(readFileSync(join(ROOT, "config/regions.json"), "utf8"));
const region = config.regions.find((r) => r.id === regionId);
const AGG = resolve(ROOT, args.agg ?? join("data/processed/agg", regionId));
const RAW = resolve(ROOT, args.raw ?? join("data/raw/firms-api", regionId));
const OUT = resolve(ROOT, args.out ?? "public/data/v2", regionId);
const SHARD_RES = 1;
const sha = (b) => createHash("sha256").update(b).digest("hex");

const status = JSON.parse(readFileSync(join(AGG, "months.json"), "utf8"));
const months = Object.keys(status).sort();
const incomplete = months.filter((m) => status[m].status !== "complete");
if (incomplete.length && !args["allow-partial"]) {
  console.error(`Refusing to publish: ${incomplete.length} incomplete months (first ${incomplete[0]}). Use --allow-partial to publish complete months only.`);
  process.exit(1);
}
const complete = months.filter((m) => status[m].status === "complete");

const toWire = (r, cellIdx, periodIdx) => [
  cellIdx, periodIdx, encodeHist(r.day), encodeHist(r.night), encodeHist(r.any),
  PLATFORMS.map((p) => r.det[p] ?? 0),
  PLATFORMS.map((p) => Math.round((r.frp[p] ?? 0) * 10) / 10),
];
const readAgg = (kind, m) => JSON.parse(gunzipSync(readFileSync(join(AGG, kind, `${m}.json.gz`))).toString());

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(join(OUT, "monthly"), { recursive: true });
const files = [];
function emit(rel, obj) {
  const json = JSON.stringify(obj);
  const gz = gzipSync(json, { level: 9 });
  const file = join(OUT, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, gz);
  files.push({ path: rel.replaceAll("\\", "/"), bytes: gz.length, sha256: sha(gz), decodedSha256: sha(json), rows: obj.rows.length });
}

// ---- monthly shards + region monthly totals --------------------------------
const shards = new Map(); // res1 -> {cells: Map(cell->idx), rows: []}
const regionMonthly = [];
for (const [pi, m] of complete.entries()) {
  const rows = readAgg("monthly", m);
  for (const r of rows) {
    const shard = cellToParent(r.cell, SHARD_RES);
    let s = shards.get(shard);
    if (!s) shards.set(shard, (s = { cells: new Map(), rows: [] }));
    if (!s.cells.has(r.cell)) s.cells.set(r.cell, s.cells.size);
    s.rows.push(toWire(r, s.cells.get(r.cell), pi));
  }
  const total = sumRows(rows.map((r) => fromWire(toWire(r, -1, pi))));
  regionMonthly.push([-1, pi, total.day, total.night, total.any, total.det, total.frp.map((v) => Math.round(v * 10) / 10)]);
}
for (const [shard, s] of [...shards].sort()) {
  // Re-index cells in sorted order for deterministic output.
  const sorted = [...s.cells.keys()].sort();
  const remap = new Map([...s.cells].map(([c, i]) => [i, sorted.indexOf(c)]));
  const rows = s.rows.map((w) => [remap.get(w[0]), ...w.slice(1)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  emit(`monthly/${shard}.json.gz`, { v: 2, region: regionId, kind: "monthly", res: 5, shard, periods: complete, cells: sorted, rows });
}
emit("region-monthly.json.gz", { v: 2, region: regionId, kind: "monthly", res: 5, shard: "region", periods: complete, cells: [], rows: regionMonthly });

// ---- zone monthly: res-1 zones (= shards) x month, full wire rows ---------------
// Lets the browser harmonize the whole region per zone (the calibration's
// spatial unit) without downloading every cell shard.
{
  const zoneCells = [...shards.keys()].sort();
  const zoneRows = [];
  for (const [zi, zone] of zoneCells.entries()) {
    const byPeriod = new Map();
    for (const w of shards.get(zone).rows) {
      if (!byPeriod.has(w[1])) byPeriod.set(w[1], []);
      byPeriod.get(w[1]).push(fromWire(w));
    }
    for (const [pi, rs] of byPeriod) {
      const t = sumRows(rs);
      zoneRows.push([zi, pi, t.day, t.night, t.any, t.det, t.frp.map((v) => Math.round(v * 10) / 10)]);
    }
  }
  zoneRows.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  emit("zone-monthly.json.gz", { v: 2, region: regionId, kind: "monthly", res: SHARD_RES, shard: "zones", periods: complete, cells: zoneCells, rows: zoneRows });
}

// ---- preset AOIs (states / countries): zone x month aggregates -----------------
// Same cell-centre rule and the same point-in-polygon code as the browser
// (src/data/v2/aoi.ts), so a preset file equals filtering the cell shards.
{
  const presetFile = join(ROOT, "public/data/presets", `${regionId}.json`);
  if (existsSync(presetFile)) {
    const { makeAoiTest } = await import("../../src/data/v2/aoi.ts");
    const { cellToLatLng } = await import("h3-js");
    const presets = JSON.parse(readFileSync(presetFile, "utf8")).items;
    for (const p of presets) {
      const keep = makeAoiTest(p.polys);
      const zoneCells = [], rows = [];
      let cellsInside = 0;
      for (const [shard, s] of [...shards].sort()) {
        const cells = [...s.cells.keys()];
        const inside = cells.map((c) => { const [lat, lon] = cellToLatLng(c); return keep(lon, lat); });
        const n = inside.filter(Boolean).length;
        if (!n) continue;
        cellsInside += n;
        const zi = zoneCells.push(shard) - 1;
        const byPeriod = new Map();
        for (const w of s.rows) {
          if (!inside[w[0]]) continue;
          if (!byPeriod.has(w[1])) byPeriod.set(w[1], []);
          byPeriod.get(w[1]).push(fromWire(w));
        }
        for (const [pi, rs] of byPeriod) { const t = sumRows(rs); rows.push([zi, pi, t.day, t.night, t.any, t.det, t.frp.map((v) => Math.round(v * 10) / 10)]); }
      }
      rows.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      emit(`aoi/${p.id}.json.gz`, { v: 2, region: regionId, kind: "monthly", res: SHARD_RES, shard: "zones", periods: complete, cells: zoneCells, rows, aoi: { id: p.id, name: p.name, cellsInside } });
    }
  }
}

// ---- cell index: res-5 cells per res-1 shard -----------------------------------
// Lets the browser classify shards against an AOI (all / some / no cell centres
// inside) before downloading: fully covered shards use zone-monthly instead.
{
  const shardIds = [...shards.keys()].sort();
  emit("cells.json.gz", { v: 2, region: regionId, kind: "cells", res: 5, shard: "index", periods: [], cells: shardIds, rows: shardIds.map((s, i) => [i, [...shards.get(s).cells.keys()].sort()]) });
}

// ---- map overview: res-3 cells x year, raw fire-cell-days ---------------------
// [cellIdx, yearIdx, anySensor, MODIS (Terra∪Aqua), VIIRS (any VIIRS)] from the
// any-time histograms (exact unions). Raw observations, for map context only.
const OVERVIEW_RES = 3;
const unionOf = (flat, mask) => { let n = 0; for (let i = 0; i < flat.length; i += 2) if (flat[i] & mask) n += flat[i + 1]; return n; };
const ovYears = [...new Set(complete.map((m) => m.slice(0, 4)))].sort();
const ov = new Map();
for (const [shard, s] of shards) {
  const cells = [...s.cells.keys()];
  for (const w of s.rows) {
    const cell = cellToParent(cells[w[0]], OVERVIEW_RES);
    const key = `${cell}|${complete[w[1]].slice(0, 4)}`;
    const t = ov.get(key) ?? [0, 0, 0];
    t[0] += unionOf(w[4], 31); t[1] += unionOf(w[4], 3); t[2] += unionOf(w[4], 28);
    ov.set(key, t);
  }
}
const ovCells = [...new Set([...ov.keys()].map((k) => k.split("|")[0]))].sort();
const ovCellIdx = new Map(ovCells.map((c, i) => [c, i]));
const ovRows = [...ov].map(([k, t]) => { const [c, y] = k.split("|"); return [ovCellIdx.get(c), ovYears.indexOf(y), ...t]; }).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
emit("overview.json.gz", { v: 2, region: regionId, kind: "overview", res: OVERVIEW_RES, shard: "region", periods: ovYears, cells: ovCells, rows: ovRows, columns: ["cell", "year", "anySensor", "MODIS", "VIIRS"] });

// ---- daily shards per year + region daily totals ----------------------------
const days = [];
const regionDaily = [];
const zoneDailyRows = [];
const years = [...new Set(complete.map((m) => m.slice(0, 4)))].sort();
for (const year of years) {
  const ym = complete.filter((m) => m.startsWith(year));
  const byShard = new Map();
  const yearDays = [];
  const rowsByDay = new Map();
  for (const m of ym)
    for (const r of readAgg("daily", m)) {
      if (!rowsByDay.has(r.period)) rowsByDay.set(r.period, []);
      rowsByDay.get(r.period).push(r);
    }
  for (const d of [...rowsByDay.keys()].sort()) yearDays.push(d);
  const dayIdx = new Map(yearDays.map((d, i) => [d, i]));
  for (const [d, rows] of rowsByDay) {
    for (const r of rows) {
      const shard = cellToParent(r.cell, SHARD_RES);
      if (!byShard.has(shard)) byShard.set(shard, []);
      byShard.get(shard).push(r);
    }
  }
  for (const [shard, rows] of [...byShard].sort()) {
    const cells = [...new Set(rows.map((r) => r.cell))].sort();
    const ci = new Map(cells.map((c, i) => [c, i]));
    const wire = rows.map((r) => toWire(r, ci.get(r.cell), dayIdx.get(r.period))).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    emit(`daily/${shard}/${year}.json.gz`, { v: 2, region: regionId, kind: "daily", res: 5, shard, periods: yearDays, cells, rows: wire });
    // zone-daily: this shard's per-day totals (res-1 zone x day)
    const perDay = new Map();
    for (const w of wire) { const d = yearDays[w[1]]; if (!perDay.has(d)) perDay.set(d, []); perDay.get(d).push(fromWire(w)); }
    for (const [d, rs] of perDay) zoneDailyRows.push({ shard, day: d, total: sumRows(rs) });
  }
  for (const d of yearDays) {
    const total = sumRows(rowsByDay.get(d).map((r) => fromWire(toWire(r, -1, 0))));
    days.push(d);
    regionDaily.push([-1, days.length - 1, total.day, total.night, total.any, total.det, total.frp.map((v) => Math.round(v * 10) / 10)]);
  }
}
emit("region-daily.json.gz", { v: 2, region: regionId, kind: "daily", res: 5, shard: "region", periods: days, cells: [], rows: regionDaily });

// ---- zone daily: res-1 zones x day (daily values for large areas without cell shards)
{
  const zones = [...new Set(zoneDailyRows.map((r) => r.shard))].sort();
  const zi = new Map(zones.map((z, i) => [z, i])), di = new Map(days.map((d, i) => [d, i]));
  const rows = zoneDailyRows.map(({ shard, day, total: t }) => [zi.get(shard), di.get(day), t.day, t.night, t.any, t.det, t.frp.map((v) => Math.round(v * 10) / 10)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  emit("zone-daily.json.gz", { v: 2, region: regionId, kind: "daily", res: SHARD_RES, shard: "zones", periods: days, cells: zones, rows });
}

// ---- manifest ----------------------------------------------------------------
const codeHash = (p) => sha(readFileSync(join(ROOT, p)));
const staticInfo = JSON.parse(readFileSync(join(AGG, "static-cells.json"), "utf8"));
const manifest = {
  v: 2,
  region: { id: region.id, name: region.name, boxes: region.boxes },
  product: {
    unit: "fire-cell-day",
    definition: "One H3 resolution-8 cell (~0.74 km²) on one UTC day with at least one active-fire detection. Histograms count cell-days by the exact set of platforms that detected fire there; an any-sensor count is a union, never a sum of detections.",
    fineResolution: 8,
    coarseResolution: 5,
    shardResolution: SHARD_RES,
    platforms: PLATFORMS,
    platformBits: { Terra: 1, Aqua: 2, "S-NPP": 4, "NOAA-20": 8, "NOAA-21": 16 },
    staticSourceMask: { rule: staticInfo.rule, cells: staticInfo.cells.length, filesScanned: staticInfo.filesScanned },
    zeroMeaning: "A zero is no matching records in the loaded data, never evidence that no fire occurred.",
    clip: { ...region.clip, rule: "A detection belongs to the region iff the centre of its H3 res-7 cell (~5.2 km²) lies inside the boundary polygon; applied identically to archive and API rows." },
    areaCaveat: "Region totals are clipped to the boundary polygon (coastal generalization of the boundary data applies). AOI queries include whole res-5 cells whose centres fall inside the AOI.",
  },
  sources: Object.fromEntries(config.sources.map((s) => [s.id, { ...s, available: JSON.parse(readFileSync(join(RAW, "availability.json"), "utf8"))[s.id] ?? null }])),
  planEnd: JSON.parse(readFileSync(join(RAW, "plan-end.json"), "utf8")).end,
  archive: existsSync(join(ROOT, "data/raw/firms-archive", regionId, "windows/manifest.json")) ? JSON.parse(readFileSync(join(ROOT, "data/raw/firms-archive", regionId, "windows/manifest.json"), "utf8")) : null,
  months: Object.fromEntries(months.map((m) => [m, { status: status[m].status, detections: status[m].accepted ?? null, excludedStatic: status[m].excludedStatic ?? null, outsideRegion: status[m].outsideRegion ?? null, origins: status[m].origins ?? null, fineCellDays: status[m].fineCellDays ?? null, detectionsBySource: status[m].detectionsBySource ?? null }])),
  code: Object.fromEntries(["scripts/ingest/plan.mjs", "scripts/ingest/aggregate-core.mjs", "scripts/ingest/aggregate.mjs", "scripts/ingest/publish.mjs", "src/data/v2/codec.ts"].map((p) => [p, codeHash(p)])),
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
console.log(`published ${regionId}: months=${complete.length} incomplete=${incomplete.length} files=${files.length} MB=${(totalBytes / 1e6).toFixed(2)} -> ${relative(ROOT, OUT)}`);
