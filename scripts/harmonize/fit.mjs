#!/usr/bin/env node
// Fit and validate the MODIS-equivalent harmonization for one region.
//
//   node scripts/harmonize/fit.mjs --region us [--dir public/data/v2]
//        [--train 2012-2021] [--kappa 20]
//
// Writes <dir>/<region>/calibration.json (coefficients used by the app) and
// data/processed/harmonize/<region>-validation.json (numbers for the docs).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { BIT, MODIS, union } from "../../src/data/v2/codec.ts";
import { fitRatio, fitStratified, coefficient, quantileMapFit, quantileMapApply, qmEstimate, referenceViirs, periodClass, combineOverpass, metrics, residualIntervals, selectMethod, PERIODS, METHOD_VERSION } from "../../src/data/v2/harmonize.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const regionId = args.region ?? "us";
const DIR = resolve(ROOT, args.dir ?? "public/data/v2", regionId);
const [T0, T1] = String(args.train ?? "2012-2021").split("-").map(Number);
const KAPPA = Number(args.kappa ?? 20);
const read = (rel) => JSON.parse(gunzipSync(readFileSync(join(DIR, rel))).toString());
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
const OVERPASSES = ["day", "night"];
const VP = ["S-NPP", "NOAA-20", "NOAA-21"];
const complete = (m) => manifest.months[m]?.status === "complete";

// ---- zone x month values ------------------------------------------------------
// zone = res-1 shard. For each zone/month/overpass: MODIS union, Terra, Aqua,
// and each VIIRS platform's cell-days (exact, from the mask histograms).
const zones = new Map(); // zone -> Map(month -> {day:{...}, night:{...}, any:{...}})
const values = (h) => ({ M: union(h, MODIS), Terra: union(h, BIT.Terra), Aqua: union(h, BIT.Aqua), "S-NPP": union(h, BIT["S-NPP"]), "NOAA-20": union(h, BIT["NOAA-20"]), "NOAA-21": union(h, BIT["NOAA-21"]) });
const add = (a, b) => { for (const k in b) a[k] = (a[k] ?? 0) + b[k]; return a; };
for (const f of manifest.files.filter((f) => f.path.startsWith("monthly/"))) {
  const p = read(f.path);
  const zone = p.shard;
  const byMonth = new Map();
  for (const w of p.rows) {
    const m = p.periods[w[1]];
    if (!byMonth.has(m)) byMonth.set(m, { day: {}, night: {}, any: {} });
    const z = byMonth.get(m);
    add(z.day, values(w[2])); add(z.night, values(w[3])); add(z.any, values(w[4]));
  }
  zones.set(zone, byMonth);
}
const months = Object.keys(manifest.months).filter(complete).sort();
const regionMonth = (m) => {
  const out = { day: {}, night: {}, any: {} };
  for (const zm of zones.values()) { const z = zm.get(m); if (z) for (const o of ["day", "night", "any"]) add(out[o], z[o]); }
  return out;
};
const year = (m) => +m.slice(0, 4), moy = (m) => +m.slice(5, 7);

// ---- coverage per VIIRS platform (from source availability) ----------------
const avail = (id) => manifest.sources[id]?.available;
const span = (sp, nrt, eop) => {
  const a = avail(sp), b = avail(nrt);
  if (!a && !b) return null;
  let end = b?.max ?? a.max;
  if (eop && end > eop) end = eop;
  if (end > manifest.planEnd) end = manifest.planEnd;
  return [a?.min ?? b.min, end];
};
const cover = { "S-NPP": span("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", "2026-11-02"), "NOAA-20": span("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"), "NOAA-21": span("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT") };
const fullyCovered = (m, p) => {
  const c = cover[p]; if (!c) return false;
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return c[0] <= `${m}-01` && c[1] >= (last < manifest.planEnd ? last : manifest.planEnd);
};

// ---- 1. VIIRS cross-calibration to the S-NPP scale ------------------------------
const cross = {};
for (const p of ["NOAA-20", "NOAA-21"]) {
  const pts = [];
  for (const m of months) if (fullyCovered(m, "S-NPP") && fullyCovered(m, p)) { const r = regionMonth(m).any; pts.push({ m: r["S-NPP"], v: r[p], month: m }); }
  const f = fitRatio(pts);
  cross[p] = { k: f.k, months: pts.length, first: pts[0]?.month ?? null, last: pts.at(-1)?.month ?? null };
}
const crossK = Object.fromEntries(Object.entries(cross).map(([p, c]) => [p, c.k]));
const vstar = (vals, m) => referenceViirs(m, { "S-NPP": vals["S-NPP"], "NOAA-20": vals["NOAA-20"], "NOAA-21": vals["NOAA-21"] }, cover, crossK, manifest.planEnd);

// ---- 2./3. stratified VIIRS -> MODIS calibration on training years ------------
const isTrain = (m) => year(m) >= T0 && year(m) <= T1;
const strataRows = (filter) => {
  const rows = [];
  for (const [zone, zm] of zones) for (const [m, z] of zm) {
    if (!complete(m) || !filter(m)) continue;
    for (const o of OVERPASSES) { const vs = vstar(z[o], m); if (vs.value == null) continue; rows.push({ zone, year: year(m), moy: moy(m), o, m: z[o].M, v: vs.value }); }
  }
  return rows;
};
const trainRows = strataRows(isTrain);
const table = fitStratified(trainRows, { kappa: KAPPA });
// overlap factor any / (day + night) for MODIS, per month-of-year, training years
const rho = {};
for (let mo = 1; mo <= 12; mo++) {
  let anyS = 0, dn = 0;
  for (const m of months.filter((x) => isTrain(x) && moy(x) === mo)) { const r = regionMonth(m); anyS += r.any.M; dn += r.day.M + r.night.M; }
  rho[mo] = dn ? anyS / dn : null;
}

// ---- 4. Terra-only -> Terra∪Aqua scaling (stable Aqua era) -------------------
const terraRows = [];
for (const [zone, zm] of zones) for (const [m, z] of zm)
  if (complete(m) && m >= PERIODS.aquaStart && year(m) <= T1)
    for (const o of OVERPASSES) terraRows.push({ zone, year: year(m), moy: moy(m), o, m: z[o].M, v: z[o].Terra });
const terraTable = fitStratified(terraRows, { kappa: KAPPA });

// ---- estimates ------------------------------------------------------------------
function estimateZoneMonth(zone, m, z, tbl = table) {
  const parts = {};
  for (const o of OVERPASSES) {
    const vs = vstar(z[o], m);
    const k = coefficient(tbl, zone, moy(m), o);
    parts[o] = vs.value == null || k == null ? null : k * vs.value;
  }
  if (parts.day == null || parts.night == null || rho[moy(m)] == null) return null;
  return combineOverpass(parts.day, parts.night, rho[moy(m)]);
}
const regionEstimate = (m, tbl) => {
  let s = 0, ok = false;
  for (const [zone, zm] of zones) { const z = zm.get(m); if (!z) continue; const e = estimateZoneMonth(zone, m, z, tbl); if (e != null) { s += e; ok = true; } }
  return ok ? s : null;
};

// ---- 5. leave-one-year-out validation -----------------------------------------
const trainYears = [...new Set(trainRows.map((r) => r.year))].sort();
const val = { proposed: { o: [], p: [] }, raw: { o: [], p: [] }, global: { o: [], p: [] }, qm: { o: [], p: [] } };
const loyo = { stratified: [], qm: [] }; // held-out {year, obs, pred} per method
const annualBy = { stratified: [], qm: [] };
const yearQm = new Map();
// VIIRS reference (S-NPP scale) for quantile mapping: day + night, as fitted.
const xAnyVstar = (z, m) => { const d = vstar(z.day, m).value, n = vstar(z.night, m).value; return d == null || n == null ? null : d + n; };
const regionAnyVstar = (m) => xAnyVstar(regionMonth(m), m);
const qmFor = (ms) => { const ok = ms.filter((m) => regionAnyVstar(m) != null); return quantileMapFit(ok.map(regionAnyVstar), ok.map((m) => regionMonth(m).any.M)); };
for (const y of trainYears) {
  const tr = trainRows.filter((r) => r.year !== y);
  const tbl = fitStratified(tr, { kappa: KAPPA });
  const g = fitRatio(tr).k; // single global ratio (day+night pooled)
  const qm = qmFor(months.filter((m) => isTrain(m) && year(m) !== y));
  yearQm.set(y, qm);
  let yo = 0, yp = 0, yq = 0;
  for (const m of months.filter((x) => year(x) === y)) {
    const obs = regionMonth(m).any.M, vAny = regionAnyVstar(m), est = regionEstimate(m, tbl);
    if (est == null || vAny == null) continue;
    const q = quantileMapApply(qm, vAny);
    val.proposed.o.push(obs); val.proposed.p.push(est);
    val.raw.o.push(obs); val.raw.p.push(regionMonth(m).any["S-NPP"] ?? vAny);
    val.global.o.push(obs); val.global.p.push(g * vAny * (rho[moy(m)] ?? 1));
    val.qm.o.push(obs); val.qm.p.push(q);
    loyo.stratified.push({ year: y, obs, pred: est });
    loyo.qm.push({ year: y, obs, pred: q });
    yo += obs; yp += est; yq += q;
  }
  annualBy.stratified.push({ year: y, observed: yo, estimated: Math.round(yp), ratio: yo ? yp / yo : null });
  annualBy.qm.push({ year: y, observed: yo, estimated: Math.round(yq), ratio: yo ? yq / yo : null });
}
const summary = Object.fromEntries(Object.entries(val).filter(([, v]) => v.o.length).map(([k, v]) => [k, metrics(v.o, v.p)]));
// v2: pre-registered per-region method choice on held-out monthly MAE.
const selected = selectMethod({ stratified: summary.proposed?.mae ?? Infinity, qm: summary.qm?.mae ?? NaN });
const annual = annualBy[selected];
const qmFull = qmFor(months.filter(isTrain));
// Intervals from held-out residuals of each method; coverage itself out-of-sample.
const intervalBy = Object.fromEntries(Object.entries(loyo).map(([k, rows]) => [k, rows.length >= 8 ? residualIntervals(rows, 0.9) : null]));
const intervals = intervalBy[selected];

// ---- 5b. zone-scale LOYO (AOI-like scale: res-1 zones, ~600,000 km²) -------
// Compares proposed (zone-specific, shrunk) vs region-level coefficients
// applied to the zone, and reports error relative to the zone's own size.
const zoneVal = [];
for (const y of trainYears) {
  const tbl = fitStratified(trainRows.filter((r) => r.year !== y), { kappa: KAPPA });
  const regionOnly = new Map([...tbl].filter(([k]) => k.startsWith("*|")));
  const qm = yearQm.get(y);
  for (const [zone, zm] of zones) {
    let o = 0, p = 0, q = 0, s = 0, ok = false;
    for (const m of months.filter((x) => year(x) === y)) {
      const z = zm.get(m); if (!z) continue;
      const e = estimateZoneMonth(zone, m, z, tbl), e2 = estimateZoneMonth(zone, m, z, regionOnly);
      const xr = regionAnyVstar(m), xz = xAnyVstar(z, m);
      if (e == null || e2 == null || xr == null || xz == null) continue;
      // QM share rule (v2): region QM estimate distributed by VIIRS-reference share.
      const share = xr > 0 ? (quantileMapApply(qm, xr) * xz) / xr : 0;
      o += z.any.M; p += e; q += e2; s += share; ok = true;
    }
    if (ok && o > 0) zoneVal.push({ zone, year: y, observed: o, proposed: p, regionCoeffs: q, qmShare: s });
  }
}
const zoneSummary = (() => {
  const big = zoneVal.filter((r) => r.observed >= 500);
  const relErr = (k) => big.map((r) => Math.abs(r[k] - r.observed) / r.observed).sort((a, b) => a - b);
  const med = (a) => a.length ? a[Math.floor(a.length / 2)] : null;
  const p90 = (a) => a.length ? a[Math.floor(a.length * 0.9)] : null;
  return {
    zoneYears: zoneVal.length, zoneYearsWithAtLeast500: big.length,
    annualAbsRelErrorMedian: { proposed: med(relErr("proposed")), regionCoefficients: med(relErr("regionCoeffs")), qmShare: med(relErr("qmShare")) },
    annualAbsRelErrorP90: { proposed: p90(relErr("proposed")), regionCoefficients: p90(relErr("regionCoeffs")), qmShare: p90(relErr("qmShare")) },
    monthlyMetricsAllZones: null,
  };
})();

// ---- 5c. Terra-only -> Terra∪Aqua scaling, LOYO over the Aqua era ----------
const terraVal = { o: [], p: [] };
const terraLoyo = [];
const terraYears = [...new Set(terraRows.map((r) => r.year))].sort();
for (const y of terraYears) {
  const tbl = fitStratified(terraRows.filter((r) => r.year !== y), { kappa: KAPPA });
  for (const m of months.filter((x) => year(x) === y && x >= PERIODS.aquaStart)) {
    let est = 0, ok = false;
    for (const [zone, zm] of zones) {
      const z = zm.get(m); if (!z) continue;
      const parts = OVERPASSES.map((o) => { const k = coefficient(tbl, zone, moy(m), o); return k == null ? null : k * z[o].Terra; });
      if (parts.some((x) => x == null) || rho[moy(m)] == null) continue;
      est += combineOverpass(parts[0], parts[1], rho[moy(m)]); ok = true;
    }
    if (ok) { terraVal.o.push(regionMonth(m).any.M); terraVal.p.push(est); terraLoyo.push({ year: y, obs: regionMonth(m).any.M, pred: est }); }
  }
}
const terraSummary = terraVal.o.length ? metrics(terraVal.o, terraVal.p) : null;
const terraInterval = terraLoyo.length >= 8 ? residualIntervals(terraLoyo, 0.9) : null;
const terraEstimate = (m) => {
  let est = 0, ok = false;
  for (const [zone, zm] of zones) {
    const z = zm.get(m); if (!z) continue;
    const parts = OVERPASSES.map((o) => { const k = coefficient(terraTable, zone, moy(m), o); return k == null ? null : k * z[o].Terra; });
    if (parts.some((x) => x == null) || rho[moy(m)] == null) continue;
    est += combineOverpass(parts[0], parts[1], rho[moy(m)]); ok = true;
  }
  return ok ? est : null;
};

// ---- VIIRS-level secondary scale ------------------------------------------------
// VIIRS reference any-time cell-days (S-NPP scale) where observed; before
// VIIRS, the MODIS-equivalent value times the training ratio V*any / MODIS any
// for that month of year (inverse calibration, estimated).
const modisToViirsByMoy = {};
for (let mo = 1; mo <= 12; mo++) {
  let v = 0, mm = 0;
  for (const m of months.filter((x) => isTrain(x) && moy(x) === mo)) { const r = regionMonth(m); const va = vstar(r.any, m).value; if (va == null) continue; v += va; mm += r.any.M; }
  modisToViirsByMoy[mo] = mm ? +(v / mm).toFixed(6) : null;
}

// ---- region series under the published calibration (browser equivalence check)
const lastDay = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const regionSeries = {};
for (const m of months) {
  const cls = periodClass(m);
  const end = lastDay(m) < manifest.planEnd ? lastDay(m) : manifest.planEnd;
  const f = +lastDay(m).slice(8) / +end.slice(8);
  const r = regionMonth(m);
  let value = null, iv = null;
  if (cls === "modis-observed") value = r.any.M;
  else if (cls === "terra-only-estimated") { value = terraEstimate(m); iv = terraInterval; }
  else { const x = regionAnyVstar(m); value = selected === "qm" ? (x == null ? null : qmEstimate(qmFull, x, f)) : regionEstimate(m, table); iv = intervals; }
  const va = vstar(r.any, m).value;
  const viirsLevel = va != null ? va : value == null || modisToViirsByMoy[moy(m)] == null ? null : value * modisToViirsByMoy[moy(m)];
  regionSeries[m] = { cls, value: value == null ? null : +value.toFixed(3), lo: value == null || !iv ? value : +(value * iv.lo).toFixed(3), hi: value == null || !iv ? value : +(value * iv.hi).toFixed(3), viirsLevel: viirsLevel == null ? null : +viirsLevel.toFixed(3), viirsObserved: va != null };
}

// ---- 6. drift diagnostic: observed MODIS vs VIIRS-estimated after training ---
const drift = [];
for (const y of [...new Set(months.map(year))].filter((y) => y > T1).sort()) {
  let o = 0, e = 0;
  for (const m of months.filter((x) => year(x) === y)) {
    const end = lastDay(m) < manifest.planEnd ? lastDay(m) : manifest.planEnd;
    const x = regionAnyVstar(m);
    const est = selected === "qm" ? (x == null ? null : qmEstimate(qmFull, x, +lastDay(m).slice(8) / +end.slice(8))) : regionEstimate(m, table);
    if (est == null) continue;
    o += regionMonth(m).any.M; e += est;
  }
  drift.push({ year: y, modisObserved: o, viirsEstimated: Math.round(e), observedOverEstimated: e ? o / e : null });
}

// ---- outputs ------------------------------------------------------------------
const serial = (t) => Object.fromEntries([...t].map(([k, v]) => [k, { k: v.k == null ? null : +v.k.toFixed(6), m: v.m, v: +v.v.toFixed(1), n: v.n }]));
const calibration = {
  method: METHOD_VERSION,
  region: regionId,
  inputManifestSha256: createHash("sha256").update(readFileSync(join(DIR, "manifest.json"))).digest("hex"),
  trainingYears: [T0, T1], trainingYearsWithData: trainYears, kappa: KAPPA,
  periods: PERIODS,
  periodRule: { "terra-only-estimated": "before Aqua: Terra-only MODIS x Terra->Terra∪Aqua factor", "modis-observed": "MODIS Terra∪Aqua as observed", "viirs-estimated": selected === "qm" ? "region: quantile mapping of the VIIRS reference (day + night) to MODIS any-time; AOI: region estimate x AOI share of the VIIRS reference" : "VIIRS reference x stratified MODIS/VIIRS ratio (day, night) combined with overlap factor rho" },
  selection: {
    selected,
    rule: "Pre-registered (v2): quantile mapping if its leave-one-year-out monthly MAE is strictly lower than the stratified ratio's; otherwise the stratified ratio.",
    looMonthlyMae: { stratified: +summary.proposed.mae.toFixed(2), qm: +summary.qm.mae.toFixed(2), global: +summary.global.mae.toFixed(2) },
  },
  viirsCover: cover, crossCalibration: cross,
  rho,
  viirsToModis: serial(table),
  terraToModis: serial(terraTable),
  qm: { x: qmFull.v.map((x) => +x.toFixed(4)), m: qmFull.m, basis: "x = VIIRS reference day + night cell-days (S-NPP scale), m = MODIS any-time cell-days, whole-region training months" },
  interval90: intervals ? { lo: +intervals.lo.toFixed(4), hi: +intervals.hi.toFixed(4), outOfSampleCoverage: +intervals.coverage.toFixed(3), n: intervals.n, note: "Multiplicative bounds from held-out (leave-one-year-out) residuals of the selected method, region-scale monthly totals; small AOIs add Poisson sampling noise (z·sqrt(estimate))." } : null,
  terraInterval90: terraInterval ? { lo: +terraInterval.lo.toFixed(4), hi: +terraInterval.hi.toFixed(4), outOfSampleCoverage: +terraInterval.coverage.toFixed(3), n: terraInterval.n } : null,
  viirsLevel: { basis: "VIIRS reference any-time cell-days on the S-NPP scale where a full VIIRS month exists; otherwise MODIS-equivalent x training ratio for the month of year (estimated)", modisToViirsByMoy },
  regionSeries,
};
writeFileSync(join(DIR, "calibration.json"), JSON.stringify(calibration, null, 1));
mkdirSync(join(ROOT, "data/processed/harmonize"), { recursive: true });
const validation = { method: METHOD_VERSION, region: regionId, selected, trainingYearsWithData: trainYears, monthlyLOYO: summary, annualLOYO: annual, annualLOYOByMethod: annualBy, zoneLOYO: zoneSummary, zoneYears: zoneVal, terraOnlyLOYO: terraSummary, terraInterval90: calibration.terraInterval90, rho, coefficientSummary: Object.fromEntries([...table].filter(([k]) => k.startsWith("*|")).map(([k, v]) => [k, +v.k.toFixed(4)])), terraCoefficientSummary: Object.fromEntries([...terraTable].filter(([k]) => k.startsWith("*|*")).map(([k, v]) => [k, +v.k.toFixed(4)])), interval90: calibration.interval90, interval90ByMethod: intervalBy, crossCalibration: cross, drift, months: months.length };
writeFileSync(join(ROOT, "data/processed/harmonize", `${regionId}-validation.json`), JSON.stringify(validation, null, 1));
console.log(JSON.stringify({ selected, monthlyLOYO: summary, annual, zoneLOYO: zoneSummary, interval90: calibration.interval90, interval90ByMethod: intervalBy, terraOnlyLOYO: terraSummary, terraInterval90: calibration.terraInterval90, drift, modisToViirsByMoy }, null, 1));
