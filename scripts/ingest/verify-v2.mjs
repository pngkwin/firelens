#!/usr/bin/env node
// Verify a published v2 bundle: hashes, row counts and exact reconciliation.
//   node scripts/ingest/verify-v2.mjs [--dir public/data/v2] [--region us]
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { union, ALL, addHist, fromWire } from "../../src/data/v2/codec.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const DIR = resolve(ROOT, args.dir ?? "public/data/v2");
const regions = args.region ? [args.region] : existsSync(DIR) ? readdirSync(DIR).filter((d) => existsSync(join(DIR, d, "manifest.json"))) : [];
const sha = (b) => createHash("sha256").update(b).digest("hex");
let errors = 0;
const fail = (m) => { errors++; console.error(`FAIL ${m}`); };
const eqHist = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const id of regions) {
  const base = join(DIR, id);
  const manifest = JSON.parse(readFileSync(join(base, "manifest.json"), "utf8"));
  const parts = new Map();
  for (const f of manifest.files) {
    const gz = readFileSync(join(base, f.path));
    if (gz.length !== f.bytes || sha(gz) !== f.sha256) { fail(`${id}/${f.path} compressed hash/size`); continue; }
    const json = gunzipSync(gz).toString();
    if (sha(json) !== f.decodedSha256) { fail(`${id}/${f.path} decoded hash`); continue; }
    const p = JSON.parse(json);
    if (p.rows.length !== f.rows) fail(`${id}/${f.path} row count`);
    parts.set(f.path, p);
  }
  const rm = parts.get("region-monthly.json.gz"), rd = parts.get("region-daily.json.gz");
  if (!rm || !rd) { fail(`${id} missing region totals`); continue; }

  // 1. shards sum to region monthly totals (per period, every histogram)
  const sums = rm.periods.map(() => ({ day: [], night: [], any: [], det: [0, 0, 0, 0, 0] }));
  for (const [path, p] of parts) {
    if (!path.startsWith("monthly/")) continue;
    if (JSON.stringify(p.periods) !== JSON.stringify(rm.periods)) fail(`${path} periods differ from region totals`);
    for (const w of p.rows) {
      const r = fromWire(w), s = sums[w[1]];
      s.day = addHist(s.day, r.day); s.night = addHist(s.night, r.night); s.any = addHist(s.any, r.any);
      r.det.forEach((v, i) => (s.det[i] += v));
    }
  }
  for (const w of rm.rows) {
    const r = fromWire(w), s = sums[w[1]], m = rm.periods[w[1]];
    if (!eqHist(s.any, r.any) || !eqHist(s.day, r.day) || !eqHist(s.night, r.night) || JSON.stringify(s.det) !== JSON.stringify(r.det)) fail(`${id} ${m}: shards != region total`);
    // 2. any-sensor union == distinct fine cell-days counted by the aggregator
    const fine = manifest.months[m]?.fineCellDays;
    if (fine != null && union(r.any, ALL) !== fine) fail(`${id} ${m}: union ${union(r.any, ALL)} != fineCellDays ${fine}`);
    // 3. detections reconcile with the per-month detection tally
    const det = r.det.reduce((a, b) => a + b, 0);
    if (manifest.months[m]?.detections != null && det !== manifest.months[m].detections) fail(`${id} ${m}: detections ${det} != ${manifest.months[m].detections}`);
  }
  // 4. daily region totals sum to monthly region totals
  const dailyByMonth = new Map();
  for (const w of rd.rows) {
    const m = rd.periods[w[1]].slice(0, 7);
    dailyByMonth.set(m, addHist(dailyByMonth.get(m) ?? [], w[4]));
  }
  for (const w of rm.rows) {
    const m = rm.periods[w[1]];
    if (!eqHist(dailyByMonth.get(m) ?? [], w[4])) fail(`${id} ${m}: daily totals != monthly total`);
  }
  // 5. daily shards sum to daily region totals
  const dsum = new Map();
  for (const [path, p] of parts)
    if (path.startsWith("daily/"))
      for (const w of p.rows) { const d = p.periods[w[1]]; dsum.set(d, addHist(dsum.get(d) ?? [], w[4])); }
  for (const w of rd.rows) if (!eqHist(dsum.get(rd.periods[w[1]]) ?? [], w[4])) fail(`${id} ${rd.periods[w[1]]}: daily shards != daily total`);
  // 6a. zone monthly (res-1 zones) sums to region monthly
  const zm = parts.get("zone-monthly.json.gz");
  if (!zm) fail(`${id} missing zone-monthly`);
  else {
    const zs = new Map();
    for (const w of zm.rows) zs.set(w[1], addHist(zs.get(w[1]) ?? [], w[4]));
    for (const w of rm.rows) if (!eqHist(zs.get(w[1]) ?? [], w[4])) fail(`${id} ${rm.periods[w[1]]}: zone-monthly != region total`);
  }
  // 6c. cell index lists exactly each monthly shard's cells
  const ci = parts.get("cells.json.gz");
  if (!ci) fail(`${id} missing cells index`);
  else for (const [i, cells] of ci.rows) {
    const p = parts.get(`monthly/${ci.cells[i]}.json.gz`);
    if (!p || JSON.stringify(p.cells) !== JSON.stringify(cells)) fail(`${id} cells index != monthly/${ci.cells[i]}`);
  }
  // 6b. map overview (res-3 x year) reconciles with region totals per year
  const ov = parts.get("overview.json.gz");
  if (!ov) fail(`${id} missing overview`);
  else {
    const byYear = new Map();
    for (const w of rm.rows) {
      const y = rm.periods[w[1]].slice(0, 4), t = byYear.get(y) ?? [0, 0, 0];
      t[0] += union(w[4], ALL); t[1] += union(w[4], 3); t[2] += union(w[4], 28);
      byYear.set(y, t);
    }
    const ovYear = new Map();
    for (const w of ov.rows) { const y = ov.periods[w[1]], t = ovYear.get(y) ?? [0, 0, 0]; for (let i = 0; i < 3; i++) t[i] += w[2 + i]; ovYear.set(y, t); }
    for (const [y, t] of byYear) if (JSON.stringify(ovYear.get(y)) !== JSON.stringify(t)) fail(`${id} ${y}: overview != region totals`);
  }

  const complete = Object.values(manifest.months).filter((m) => m.status === "complete").length;
  console.log(`${id}: files=${manifest.files.length} months complete=${complete}/${Object.keys(manifest.months).length} ${errors ? "ERRORS" : "OK"}`);
}
if (!regions.length) console.log("no v2 bundles found");
process.exit(errors ? 1 : 0);
