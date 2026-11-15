#!/usr/bin/env node
// Cross-check FIRMS Archive Download CSVs against API windows on the dates
// where every API box for that source is downloaded.
//
//   node scripts/ingest/compare-archive.mjs --region us
//
// Expectation: the archive (country polygon) is a subset of the API boxes, so
// every archive row in a covered date should match an API row exactly
// (lat, lon, date, time, satellite). API rows absent from the archive should be
// outside the country (Canada/Mexico parts of the boxes, or ocean).
import { readFileSync, existsSync, readdirSync, writeFileSync, createReadStream, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createInterface } from "node:readline";
import { planJobs } from "./plan.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const regionId = args.region ?? "us";
const config = JSON.parse(readFileSync(join(ROOT, "config/regions.json"), "utf8"));
const region = config.regions.find((r) => r.id === regionId);
const RAW = join(ROOT, "data/raw/firms-api", regionId);
const ARCH = join(ROOT, "data/raw/firms-archive", regionId);
const availability = JSON.parse(readFileSync(join(RAW, "availability.json"), "utf8"));
const end = JSON.parse(readFileSync(join(RAW, "plan-end.json"), "utf8")).end;
const jobs = planJobs({ sources: config.sources, availability, region, end });
const fileFor = (j) => join(RAW, j.source, j.box, j.date.slice(0, 4), `${j.date}_${j.days}.csv.gz`);
const MAP = { "M-C61": "MODIS_SP", "SV-C2": "VIIRS_SNPP_SP", "J1V-C2": "VIIRS_NOAA20_SP", "J2V-C2": "VIIRS_NOAA21_SP" };
// Coordinates are compared at 4 decimals (archive and API can differ in trailing digits).
import { platformOf } from "./aggregate-core.mjs";
import { makeClip } from "./clip.mjs";
const clip = makeClip(region);
// Satellite codes differ between products (archive "SNPP" vs API "N"), so compare canonical platforms.
const key = (lat, lon, d, t, s) => `${(+lat).toFixed(4)}|${(+lon).toFixed(4)}|${d}|${String(t).padStart(4, "0")}|${platformOf(s)}`;

const report = {};
for (const dir of readdirSync(ARCH)) {
  const csv = readdirSync(join(ARCH, dir)).find((f) => f.startsWith("fire_archive_") && f.endsWith(".csv"));
  const tag = Object.keys(MAP).find((t) => csv?.includes(`_${t}_`));
  if (!csv || !tag) continue;
  const source = MAP[tag];
  const mine = jobs.filter((j) => j.source === source);
  // dates whose windows exist for every box
  const byDate = new Map();
  for (const j of mine) for (let i = 0; i < j.days; i++) {
    const d = new Date(Date.parse(j.date) + i * 864e5).toISOString().slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(j);
  }
  const covered = new Set([...byDate].filter(([, js]) => js.every((j) => existsSync(fileFor(j)))).map(([d]) => d));
  const api = new Map(); // key -> matched?
  const seenFiles = new Set();
  for (const d of covered) for (const j of byDate.get(d)) {
    const f = fileFor(j);
    if (seenFiles.has(f)) continue;
    seenFiles.add(f);
    const lines = gunzipSync(readFileSync(f)).toString().split(/\r?\n/);
    const h = Object.fromEntries(lines[0].split(",").map((k, i) => [k, i]));
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const x = lines[i].split(",");
      if (!covered.has(x[h.acq_date])) continue;
      api.set(key(x[h.latitude], x[h.longitude], x[h.acq_date], x[h.acq_time], x[h.satellite]), false);
    }
  }
  let archRows = 0, archCovered = 0, matched = 0, archOutsideMask = 0;
  const unmatchedExamples = [];
  const rl = createInterface({ input: createReadStream(join(ARCH, dir, csv)) });
  let h;
  for await (const line of rl) {
    if (!h) { h = Object.fromEntries(line.split(",").map((k, i) => [k, i])); continue; }
    if (!line) continue;
    archRows++;
    const x = line.split(",");
    if (!covered.has(x[h.acq_date])) continue;
    archCovered++;
    if (clip && !clip.hasPoint(+x[h.latitude], +x[h.longitude])) archOutsideMask++;
    const k = key(x[h.latitude], x[h.longitude], x[h.acq_date], x[h.acq_time], x[h.satellite]);
    if (api.has(k)) { matched++; api.set(k, true); }
    else if (unmatchedExamples.length < 5) unmatchedExamples.push(k);
  }
  let apiOnly = 0, apiOnlyInsideConusLatBand = 0, apiOnlyInsideMask = 0, apiInsideMask = 0; const interiorExamples = [];
  for (const [k, m] of api) { const [la, lo] = k.split("|").map(Number); if (clip?.hasPoint(la, lo)) { apiInsideMask++; if (!m) apiOnlyInsideMask++; } }
  for (const [k, m] of api) if (!m) {
    apiOnly++;
    const [lat, lon] = k.split("|").map(Number);
    // crude flag: well inside CONUS interior (not near borders/coasts) would be suspicious
    if (lat > 33 && lat < 47 && lon > -118 && lon < -82) { apiOnlyInsideConusLatBand++; if (interiorExamples.length < 400) interiorExamples.push([lat, lon]); }
  }
  report[source] = {
    archiveFile: csv, archiveRows: archRows, coveredDates: covered.size,
    firstCovered: [...covered].sort()[0] ?? null, lastCovered: [...covered].sort().at(-1) ?? null,
    archiveRowsOnCoveredDates: archCovered, matchedInApi: matched,
    archiveMatchRate: archCovered ? +(matched / archCovered).toFixed(6) : null,
    apiRowsOnCoveredDates: api.size, apiOnly, apiOnlyDeepInteriorConus: apiOnlyInsideConusLatBand,
    archiveOutsideMask: archOutsideMask, apiInsideMask, apiOnlyInsideMask,
    maskVsFirmsDisagreement: apiInsideMask ? +((archOutsideMask + apiOnlyInsideMask) / apiInsideMask).toFixed(6) : null,
    unmatchedExamples,
    interiorExamples,
  };
  console.log(source, JSON.stringify(report[source]));
}
mkdirSync(join(ROOT, "data/processed"), { recursive: true });
writeFileSync(join(ROOT, "data/processed", `archive-vs-api-${regionId}.json`), JSON.stringify(report, null, 1));
