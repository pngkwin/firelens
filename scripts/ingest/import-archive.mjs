#!/usr/bin/env node
// Split verified FIRMS Archive Download CSVs into the same <=5-day windows the
// API downloader uses, so the aggregator treats both identically.
//
//   node scripts/ingest/import-archive.mjs --region us
//
// Input:  data/raw/firms-archive/<region>/DL_FIRE_*/fire_archive_*.csv (+ .zip)
// Output: data/raw/firms-archive/<region>/windows/<SOURCE>/country/<YYYY>/<date>_<days>.csv.gz
//         data/raw/firms-archive/<region>/windows/manifest.json
// The archive must be date-sorted (checked) and cover the whole SP span.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, createReadStream, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { windows } from "./plan.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const regionId = args.region ?? "us";
const ARCH = join(ROOT, "data/raw/firms-archive", regionId);
const OUT = join(ARCH, "windows");
const availability = JSON.parse(readFileSync(join(ROOT, "data/raw/firms-api", regionId, "availability.json"), "utf8"));
const MAP = { "M-C61": "MODIS_SP", "SV-C2": "VIIRS_SNPP_SP", "J1V-C2": "VIIRS_NOAA20_SP", "J2V-C2": "VIIRS_NOAA21_SP" };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const shaFile = (f) => new Promise((res, rej) => { const h = createHash("sha256"); createReadStream(f).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });

const manifest = { region: regionId, box: "country", note: "FIRMS Archive Download (country polygon), split into API-plan windows. Verified row-identical to API windows on overlapping dates (scripts/ingest/compare-archive.mjs).", sources: {} };
for (const dir of readdirSync(ARCH).filter((d) => d.startsWith("DL_FIRE_")).sort()) {
  const csv = readdirSync(join(ARCH, dir)).find((f) => /^fire_archive_.*\.csv$/.test(f));
  const tag = Object.keys(MAP).find((t) => dir.includes(`_${t}_`));
  if (!csv || !tag) continue;
  const source = MAP[tag];
  const span = availability[source];
  const wins = windows(span.min, span.max, 5);
  let wi = 0, header = null, buf = [], rows = 0, written = 0, lastDate = "";
  const lastOf = (w) => new Date(Date.parse(w.date) + (w.days - 1) * 864e5).toISOString().slice(0, 10);
  const flush = () => {
    const w = wins[wi];
    const file = join(OUT, source, "country", w.date.slice(0, 4), `${w.date}_${w.days}.csv.gz`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + ".tmp", gzipSync([header, ...buf].join("\n") + "\n"));
    renameSync(file + ".tmp", file);
    written++; buf = [];
  };
  const rl = createInterface({ input: createReadStream(join(ARCH, dir, csv)) });
  for await (const line of rl) {
    if (header === null) { header = line; continue; }
    if (!line) continue;
    const d = line.split(",")[5];
    if (d < lastDate) throw Error(`${csv} not date-sorted at ${d}`);
    lastDate = d;
    if (d < span.min || d > span.max) throw Error(`${csv} row outside SP span: ${d}`);
    while (d > lastOf(wins[wi])) { flush(); wi++; }
    buf.push(line); rows++;
  }
  while (wi < wins.length) { flush(); wi++; } // trailing (possibly empty) windows
  if (!header.startsWith("latitude,longitude")) throw Error(`${csv} unexpected header`);
  manifest.sources[source] = {
    request: dir, csv, csvSha256: await shaFile(join(ARCH, dir, csv)), zipSha256: existsSync(join(ARCH, dir, `${dir}.zip`)) ? await shaFile(join(ARCH, dir, `${dir}.zip`)) : null,
    rows, windows: written, start: span.min, end: span.max, header,
  };
  console.log(`${source}: rows=${rows} windows=${written} (${span.min}..${span.max})`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
