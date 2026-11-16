#!/usr/bin/env node
// Fit and validate the MODIS-equivalent harmonization for one region.
//
//   node scripts/harmonize/fit.mjs --region us [--dir public/data/v2]
//        [--train 2012-2021] [--kappa 20]
//
// Writes <dir>/<region>/calibration.json (coefficients and the observation-
// coverage audit used by the app) and data/processed/harmonize/<region>-
// validation.json (numbers for the docs).
//
// Method v3 (see docs/harmonization-method.md):
//  - observation coverage: satellite-days without observations are detected
//    from cross-satellite evidence (src/data/v2/coverage.ts) using every
//    published region's region-daily file, and labelled confirmed/suspected
//    with config/observation-events.json;
//  - the VIIRS reference skips a satellite with flagged days in the month;
//  - months whose MODIS target or VIIRS reference lost a material share of
//    observations are left out of fitting and validation;
//  - every learned parameter (VIIRS cross-calibration, overlap factor rho,
//    ratios, quantile map) is refitted inside each leave-one-year-out fold;
//  - a nested leave-one-year-out run scores the whole select-then-fit procedure.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { BIT, MODIS, union } from "../../src/data/v2/codec.ts";
import { fitRatio, fitStratified, coefficient, quantileMapFit, quantileMapApply, qmEstimate, referenceViirs, periodClass, combineOverpass, metrics, residualIntervals, selectMethod, PERIODS, METHOD_VERSION } from "../../src/data/v2/harmonize.ts";
import { detectCoverage, flaggedDays, materialLoss, operatingIn, COVERAGE_THRESHOLDS } from "../../src/data/v2/coverage.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length));
const ROOT = resolve(import.meta.dirname, "../..");
const regionId = args.region ?? "us";
const V2DIR = resolve(ROOT, args.dir ?? "public/data/v2");
const DIR = resolve(V2DIR, regionId);
const [T0, T1] = String(args.train ?? "2012-2021").split("-").map(Number);
const KAPPA = Number(args.kappa ?? 20);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const read = (rel) => JSON.parse(gunzipSync(readFileSync(join(DIR, rel))).toString());
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
const OVERPASSES = ["day", "night"];
const complete = (m) => manifest.months[m]?.status === "complete";
const year = (m) => +m.slice(0, 4), moy = (m) => +m.slice(5, 7);
const lastDay = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const lastIn = (m) => (lastDay(m) < manifest.planEnd ? lastDay(m) : manifest.planEnd);

// ---- zone x month values ------------------------------------------------------
const zones = new Map(); // zone -> Map(month -> {day:{...}, night:{...}, any:{...}})
const values = (h) => ({ M: union(h, MODIS), Terra: union(h, BIT.Terra), Aqua: union(h, BIT.Aqua), "S-NPP": union(h, BIT["S-NPP"]), "NOAA-20": union(h, BIT["NOAA-20"]), "NOAA-21": union(h, BIT["NOAA-21"]) });
const add = (a, b) => { for (const k in b) a[k] = (a[k] ?? 0) + b[k]; return a; };
for (const f of manifest.files.filter((f) => f.path.startsWith("monthly/"))) {
  const p = read(f.path);
  const byMonth = new Map();
  for (const w of p.rows) {
    const m = p.periods[w[1]];
    if (!byMonth.has(m)) byMonth.set(m, { day: {}, night: {}, any: {} });
    const z = byMonth.get(m);
    add(z.day, values(w[2])); add(z.night, values(w[3])); add(z.any, values(w[4]));
  }
  zones.set(p.shard, byMonth);
}
const months = Object.keys(manifest.months).filter(complete).sort();
const regionCache = new Map();
const regionMonth = (m) => {
  if (regionCache.has(m)) return regionCache.get(m);
  const out = { day: {}, night: {}, any: {} };
  for (const zm of zones.values()) { const z = zm.get(m); if (z) for (const o of ["day", "night", "any"]) add(out[o], z[o]); }
  regionCache.set(m, out);
  return out;
};

// ---- VIIRS platform spans (from source availability) ----------------------------
const avail = (id) => manifest.sources[id]?.available;
// End of production comes from the manifest (config/regions.json `endOfProduction`).
const span = (sp, nrt) => {
  const a = avail(sp), b = avail(nrt);
  if (!a && !b) return null;
  let end = b?.max ?? a.max;
  const eop = [manifest.sources[sp]?.endOfProduction, manifest.sources[nrt]?.endOfProduction].filter(Boolean).sort()[0];
  if (eop && end > eop) end = eop;
  if (end > manifest.planEnd) end = manifest.planEnd;
  return [a?.min ?? b.min, end];
};
const cover = { "S-NPP": span("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"), "NOAA-20": span("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"), "NOAA-21": span("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT") };
if (manifest.sources.VIIRS_SNPP_NRT && !manifest.sources.VIIRS_SNPP_NRT.endOfProduction) throw Error("manifest: VIIRS_SNPP_NRT has no endOfProduction (check config/regions.json)");

// ---- 0. observation-coverage audit ----------------------------------------------
// Outages are spacecraft-wide, so the evidence pools every published region.
const daily = new Map();
const covInputs = [];
for (const r of readdirSync(V2DIR).sort()) {
  const p = join(V2DIR, r, "region-daily.json.gz");
  if (!existsSync(p)) continue;
  const buf = readFileSync(p);
  covInputs.push({ region: r, path: "region-daily.json.gz", sha256: sha(buf) });
  const part = JSON.parse(gunzipSync(buf).toString());
  for (const w of part.rows) {
    const d = part.periods[w[1]];
    const a = daily.get(d) ?? [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) a[i] += w[5][i];
    daily.set(d, a);
  }
}
const modisStart = [avail("MODIS_SP")?.min, avail("MODIS_NRT")?.min].filter(Boolean).sort()[0];
const aquaStart = [...daily.keys()].sort().find((d) => daily.get(d)[1] > 0) ?? null;
const operating = { Terra: [modisStart, manifest.planEnd], ...(aquaStart ? { Aqua: [aquaStart, manifest.planEnd] } : {}) };
for (const p of ["S-NPP", "NOAA-20", "NOAA-21"]) if (cover[p]) operating[p] = cover[p];
const eventsFile = join(ROOT, "config/observation-events.json");
const documented = JSON.parse(readFileSync(eventsFile, "utf8")).events;
const coverage = { ...detectCoverage(daily, operating, documented), inputs: covInputs, documentedEventsFile: { path: "config/observation-events.json", sha256: sha(readFileSync(eventsFile)) }, documented };

// ---- 0b. sensitivity of the outage audit to its thresholds ----------------------
// Detection only (the calibration is not refitted per variant): how many
// satellite-days and months each assumption flags, and whether every documented
// notice is still recovered.
const sensitivity = (() => {
  const base = COVERAGE_THRESHOLDS;
  const variants = [
    ["baseline", {}],
    ["gap < 5 %", { gapRatio: 0.05 }], ["gap < 20 %", { gapRatio: 0.2 }],
    ["reduced < 35 %", { reducedRatio: 0.35 }], ["reduced < 65 %", { reducedRatio: 0.65 }],
    ["min. expected 50", { minExpected: 50 }], ["min. expected 200", { minExpected: 200 }],
    ["material loss 2 %", { materialLoss: 0.02 }], ["material loss 10 %", { materialLoss: 0.1 }],
  ];
  return variants.map(([name, over]) => {
    const th = { ...base, ...over };
    const c = detectCoverage(daily, operating, documented, th);
    const flaggedDays = Object.values(c.flagged).reduce((s, f) => s + Object.keys(f).length, 0);
    const materialMonths = Object.values(c.monthLoss).reduce((s, ms) => s + Object.values(ms).filter((v) => v >= th.materialLoss).length, 0);
    return { name, thresholds: over, flaggedDays, runs: c.events.length, confirmedRuns: c.events.filter((e) => e.status === "confirmed").length, documentedRecovered: documented.length - c.documentedWithoutDetectedLoss.length, documented: documented.length, materialSatelliteMonths: materialMonths };
  });
})();

const flagged = (p, m) => flaggedDays(coverage, p, `${m}-01`, lastIn(m));
/** MODIS target unreliable: Terra or Aqua lost a material share, or Aqua only part of the month (July 2002). */
const modisLoss = (m) => materialLoss(coverage, "Terra", m) || (m >= PERIODS.aquaStart && (materialLoss(coverage, "Aqua", m) || operatingIn(coverage, "Aqua", `${m}-01`, lastIn(m)) === "partial"));
const fullyCovered = (m, p) => { const c = cover[p]; return !!c && c[0] <= `${m}-01` && c[1] >= lastIn(m); };

// ---- model fitting (all learned parameters; `exclude` = held-out years) --------
const isTrain = (m) => year(m) >= T0 && year(m) <= T1;
const NOV = { "S-NPP": 0, "NOAA-20": 0, "NOAA-21": 0 };
const refChoice = (m) => referenceViirs(m, NOV, cover, { "NOAA-20": 1, "NOAA-21": 1 }, manifest.planEnd, coverage); // platform choice only
const trainOk = (m) => complete(m) && isTrain(m) && !modisLoss(m) && refChoice(m).platform != null && !refChoice(m).reduced;
const excludedMonths = {};
for (const m of months.filter(isTrain)) {
  const why = [];
  if (modisLoss(m)) why.push(`MODIS target incomplete (${["Terra", "Aqua"].filter((p) => materialLoss(coverage, p, m)).join(", ") || "Aqua not operating all month"} lost >= 5% of expected detections)`);
  const rc = refChoice(m);
  if (rc.platform == null) why.push("no VIIRS satellite covers the whole month");
  else if (rc.reduced) why.push(`VIIRS reference ${rc.platform} lost ${(100 * rc.loss).toFixed(1)}% of expected detections and no other VIIRS observed every day`);
  if (why.length) excludedMonths[m] = why.join("; ");
}

function crossFor(exclude) {
  const out = {};
  for (const p of ["NOAA-20", "NOAA-21"]) {
    const pts = [];
    for (const m of months) {
      if (exclude.has(year(m)) || !fullyCovered(m, "S-NPP") || !fullyCovered(m, p) || flagged("S-NPP", m) || flagged(p, m)) continue;
      const r = regionMonth(m).any; pts.push({ m: r["S-NPP"], v: r[p], month: m });
    }
    const f = fitRatio(pts);
    out[p] = { k: f.k, months: pts.length, first: pts[0]?.month ?? null, last: pts.at(-1)?.month ?? null };
  }
  return out;
}
function rhoFor(exclude) {
  const rho = {};
  for (let mo = 1; mo <= 12; mo++) {
    let anyS = 0, dn = 0;
    for (const m of months.filter((x) => isTrain(x) && moy(x) === mo && !exclude.has(year(x)) && !modisLoss(x))) { const r = regionMonth(m); anyS += r.any.M; dn += r.day.M + r.night.M; }
    rho[mo] = dn ? anyS / dn : null;
  }
  return rho;
}
function fitModel(exclude = new Set()) {
  const cross = crossFor(exclude);
  const crossK = Object.fromEntries(Object.entries(cross).map(([p, c]) => [p, c.k]));
  const vstar = (vals, m) => referenceViirs(m, { "S-NPP": vals["S-NPP"], "NOAA-20": vals["NOAA-20"], "NOAA-21": vals["NOAA-21"] }, cover, crossK, manifest.planEnd, coverage);
  const ok = (m) => trainOk(m) && !exclude.has(year(m));
  const rows = [];
  for (const [zone, zm] of zones) for (const [m, z] of zm) {
    if (!ok(m)) continue;
    for (const o of OVERPASSES) { const vs = vstar(z[o], m); if (vs.value == null) continue; rows.push({ zone, year: year(m), moy: moy(m), o, m: z[o].M, v: vs.value }); }
  }
  const xAny = (z, m) => { const d = vstar(z.day, m).value, n = vstar(z.night, m).value; return d == null || n == null ? null : d + n; };
  const qmMonths = months.filter((m) => ok(m) && xAny(regionMonth(m), m) != null);
  return {
    cross, crossK, vstar, xAny, rows,
    table: fitStratified(rows, { kappa: KAPPA }),
    rho: rhoFor(exclude),
    qm: quantileMapFit(qmMonths.map((m) => xAny(regionMonth(m), m)), qmMonths.map((m) => regionMonth(m).any.M)),
    g: fitRatio(rows).k,
  };
}
function estimateZoneMonth(model, zone, m, z, tbl = model.table) {
  const parts = {};
  for (const o of OVERPASSES) {
    const vs = model.vstar(z[o], m);
    const k = coefficient(tbl, zone, moy(m), o);
    parts[o] = vs.value == null || k == null ? null : k * vs.value;
  }
  if (parts.day == null || parts.night == null || model.rho[moy(m)] == null) return null;
  return combineOverpass(parts.day, parts.night, model.rho[moy(m)]);
}
const estStrat = (model, m, tbl) => {
  let s = 0, ok = false;
  for (const [zone, zm] of zones) { const z = zm.get(m); if (!z) continue; const e = estimateZoneMonth(model, zone, m, z, tbl); if (e != null) { s += e; ok = true; } }
  return ok ? s : null;
};
const estQm = (model, m, f = 1) => { const x = model.xAny(regionMonth(m), m); return x == null ? null : qmEstimate(model.qm, x, f); };
const fOf = (m) => +lastDay(m).slice(8) / +lastIn(m).slice(8);

// ---- 1. leave-one-year-out with every parameter refitted per fold -------------
const trainYears = [...new Set(months.filter(trainOk).map(year))].sort();
const folds = new Map(trainYears.map((y) => [y, fitModel(new Set([y]))]));
const val = { proposed: { o: [], p: [] }, raw: { o: [], p: [] }, global: { o: [], p: [] }, qm: { o: [], p: [] } };
const loyo = { stratified: [], qm: [] };
const annualBy = { stratified: [], qm: [] };
for (const y of trainYears) {
  const fm = folds.get(y);
  let yo = 0, yp = 0, yq = 0;
  for (const m of months.filter((x) => year(x) === y && trainOk(x))) {
    const obs = regionMonth(m).any.M, vAny = fm.xAny(regionMonth(m), m), est = estStrat(fm, m), q = estQm(fm, m);
    if (est == null || vAny == null || q == null) continue;
    val.proposed.o.push(obs); val.proposed.p.push(est);
    val.raw.o.push(obs); val.raw.p.push(regionMonth(m).any["S-NPP"]);
    val.global.o.push(obs); val.global.p.push(fm.g * vAny * (fm.rho[moy(m)] ?? 1));
    val.qm.o.push(obs); val.qm.p.push(q);
    loyo.stratified.push({ year: y, month: m, obs, pred: est });
    loyo.qm.push({ year: y, month: m, obs, pred: q });
    yo += obs; yp += est; yq += q;
  }
  annualBy.stratified.push({ year: y, observed: yo, estimated: Math.round(yp), ratio: yo ? yp / yo : null });
  annualBy.qm.push({ year: y, observed: yo, estimated: Math.round(yq), ratio: yo ? yq / yo : null });
}
const summary = Object.fromEntries(Object.entries(val).filter(([, v]) => v.o.length).map(([k, v]) => [k, metrics(v.o, v.p)]));
const selected = selectMethod({ stratified: summary.proposed?.mae ?? Infinity, qm: summary.qm?.mae ?? NaN });
const annual = annualBy[selected];

// ---- 1b. nested leave-one-year-out: selection inside each outer fold ------------
// Scores the whole procedure (choose a method on the other years, then predict),
// so the selection never sees the year it is scored on.
const nested = { o: [], p: [], chosen: {} };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
for (const y of trainYears) {
  const err = { stratified: [], qm: [] };
  for (const y2 of trainYears.filter((x) => x !== y)) {
    const fm = fitModel(new Set([y, y2]));
    for (const m of months.filter((x) => year(x) === y2 && trainOk(x))) {
      const obs = regionMonth(m).any.M, e = estStrat(fm, m), q = estQm(fm, m);
      if (e == null || q == null) continue;
      err.stratified.push(Math.abs(e - obs)); err.qm.push(Math.abs(q - obs));
    }
  }
  const choice = selectMethod({ stratified: mean(err.stratified), qm: mean(err.qm) });
  nested.chosen[y] = choice;
  for (const r of loyo[choice].filter((r) => r.year === y)) { nested.o.push(r.obs); nested.p.push(r.pred); }
}
const nestedMetrics = nested.o.length ? metrics(nested.o, nested.p) : null;

const model = fitModel();
// Intervals from held-out residuals of the selected method; coverage itself out-of-sample.
const intervalBy = Object.fromEntries(Object.entries(loyo).map(([k, rows]) => [k, rows.length >= 8 ? residualIntervals(rows, 0.9) : null]));
const intervals = intervalBy[selected];

// ---- 2. zone scale (AOI-like) and small-area interval coverage ------------------
const zoneVal = [];
const zoneMonths = [];
for (const y of trainYears) {
  const fm = folds.get(y);
  const regionOnly = new Map([...fm.table].filter(([k]) => k.startsWith("*|")));
  for (const [zone, zm] of zones) {
    let o = 0, p = 0, q = 0, s = 0, ok = false;
    for (const m of months.filter((x) => year(x) === y && trainOk(x))) {
      const z = zm.get(m); if (!z) continue;
      const e = estimateZoneMonth(fm, zone, m, z), e2 = estimateZoneMonth(fm, zone, m, z, regionOnly);
      const xr = fm.xAny(regionMonth(m), m), xz = fm.xAny(z, m);
      if (e == null || e2 == null || xr == null || xz == null) continue;
      const share = xr > 0 ? (quantileMapApply(fm.qm, xr) * xz) / xr : 0;
      o += z.any.M; p += e; q += e2; s += share; ok = true;
      zoneMonths.push({ year: y, obs: z.any.M, pred: selected === "qm" ? share : e });
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
  };
})();
// The app's small-area interval: value x [lo, hi] widened by 1.645·sqrt(value).
const zoneIntervalCoverage = (() => {
  if (!intervals) return null;
  const bands = [["< 30", 0, 30], ["30-300", 30, 300], [">= 300", 300, Infinity]];
  const out = {};
  for (const [name, a, b] of bands) {
    const rs = zoneMonths.filter((r) => r.pred > 0 && r.pred >= a && r.pred < b);
    const hit = rs.filter((r) => r.obs >= Math.max(0, r.pred * intervals.lo - 1.645 * Math.sqrt(r.pred)) && r.obs <= r.pred * intervals.hi + 1.645 * Math.sqrt(r.pred)).length;
    out[name] = { zoneMonths: rs.length, coverage: rs.length ? +(hit / rs.length).toFixed(3) : null };
  }
  return { note: "Held-out zone-months (H3 res-1 zones, ~600,000 km²) predicted by the selected method fitted without that year; interval = the region interval widened by 1.645*sqrt(estimate), as in the app. The region interval itself uses all years (small leak).", byPredictedSize: out };
})();

// ---- 2b. small-area interval recalibration (overdispersion factor) ----------------
// The sampling term z·sqrt(estimate) assumes Poisson counts; fire-cell-days are
// overdispersed. Widen it by a factor c: interval = v·[lo, hi] -/+ z·c·sqrt(v).
// c is chosen as the smallest value giving >= 90 % coverage on held-out
// zone-months of the OTHER years, and scored on the held-out year (leave-one-
// year-out), so the reported coverage is out-of-sample.
const BANDS = [["< 30", 0, 30], ["30-300", 30, 300], [">= 300", 300, Infinity]];
const aoiInterval = (() => {
  if (!intervals || !zoneMonths.length) return null;
  const rows = zoneMonths.filter((r) => r.pred > 0);
  const inside = (r, c) => r.obs >= Math.max(0, r.pred * intervals.lo - 1.645 * c * Math.sqrt(r.pred)) && r.obs <= r.pred * intervals.hi + 1.645 * c * Math.sqrt(r.pred);
  const cov = (rs, c) => (rs.length ? rs.filter((r) => inside(r, c)).length / rs.length : NaN);
  const grid = Array.from({ length: 141 }, (_, i) => +(1 + i * 0.05).toFixed(2)); // 1.00 .. 8.00
  const pick = (rs) => grid.find((c) => cov(rs, c) >= 0.9) ?? grid.at(-1);
  const scored = [];
  const perYear = {};
  for (const y of trainYears) {
    const c = pick(rows.filter((r) => r.year !== y));
    perYear[y] = c;
    for (const r of rows.filter((r) => r.year === y)) scored.push({ ...r, hit: inside(r, c), base: inside(r, 1) });
  }
  const band = (key) => Object.fromEntries(BANDS.map(([name, a, b]) => { const rs = scored.filter((r) => r.pred >= a && r.pred < b); return [name, { zoneMonths: rs.length, coverage: rs.length ? +(rs.filter((r) => r[key]).length / rs.length).toFixed(3) : null }]; }));
  const all = (key) => +(scored.filter((r) => r[key]).length / scored.length).toFixed(3);
  return {
    factor: pick(rows),
    perHeldOutYear: perYear,
    outOfSample: { before: { all: all("base"), byPredictedSize: band("base") }, after: { all: all("hit"), byPredictedSize: band("hit") } },
    note: "Small-area interval = v·[lo, hi] widened by 1.645·factor·sqrt(v). factor = smallest value reaching 90 % coverage on held-out zone-months of the other years; coverage scored on each held-out year. Validated at zone scale (H3 res-1, ~600,000 km²); smaller areas are not validated separately.",
  };
})();

// ---- 3. Terra-only -> Terra∪Aqua scaling, LOYO over the Aqua era ----------
const terraOk = (m) => complete(m) && m >= PERIODS.aquaStart && year(m) <= T1 && !modisLoss(m);
const terraRowsFor = (exclude) => {
  const rows = [];
  for (const [zone, zm] of zones) for (const [m, z] of zm)
    if (terraOk(m) && !exclude.has(year(m))) for (const o of OVERPASSES) rows.push({ zone, year: year(m), moy: moy(m), o, m: z[o].M, v: z[o].Terra });
  return rows;
};
const terraEst = (tbl, rho, m) => {
  let est = 0, ok = false;
  for (const [zone, zm] of zones) {
    const z = zm.get(m); if (!z) continue;
    const parts = OVERPASSES.map((o) => { const k = coefficient(tbl, zone, moy(m), o); return k == null ? null : k * z[o].Terra; });
    if (parts.some((x) => x == null) || rho[moy(m)] == null) continue;
    est += combineOverpass(parts[0], parts[1], rho[moy(m)]); ok = true;
  }
  return ok ? est : null;
};
const terraVal = { o: [], p: [] };
const terraLoyo = [];
const terraYears = [...new Set(months.filter(terraOk).map(year))].sort();
for (const y of terraYears) {
  const ex = new Set([y]);
  const tbl = fitStratified(terraRowsFor(ex), { kappa: KAPPA }), rho = rhoFor(ex);
  for (const m of months.filter((x) => year(x) === y && terraOk(x))) {
    const est = terraEst(tbl, rho, m);
    if (est != null) { terraVal.o.push(regionMonth(m).any.M); terraVal.p.push(est); terraLoyo.push({ year: y, obs: regionMonth(m).any.M, pred: est }); }
  }
}
const terraTable = fitStratified(terraRowsFor(new Set()), { kappa: KAPPA });
const terraSummary = terraVal.o.length ? metrics(terraVal.o, terraVal.p) : null;
const terraInterval = terraLoyo.length >= 8 ? residualIntervals(terraLoyo, 0.9) : null;

// ---- VIIRS-level secondary scale ------------------------------------------------
const modisToViirsByMoy = {};
for (let mo = 1; mo <= 12; mo++) {
  let v = 0, mm = 0;
  for (const m of months.filter((x) => trainOk(x) && moy(x) === mo)) { const r = regionMonth(m); const va = model.vstar(r.any, m).value; if (va == null) continue; v += va; mm += r.any.M; }
  modisToViirsByMoy[mo] = mm ? +(v / mm).toFixed(6) : null;
}

// ---- region series under the published calibration (browser equivalence check)
const regionSeries = {};
for (const m of months) {
  const cls = periodClass(m);
  const r = regionMonth(m);
  let value = null, iv = null, reduced = false, reference = null;
  if (cls === "modis-observed") { value = r.any.M; reduced = modisLoss(m); reference = "M"; }
  else if (cls === "terra-only-estimated") { value = terraEst(terraTable, model.rho, m); iv = terraInterval; reduced = materialLoss(coverage, "Terra", m); reference = "Terra"; }
  else {
    value = selected === "qm" ? estQm(model, m, fOf(m)) : estStrat(model, m);
    iv = intervals;
    const rc = model.vstar(r.any, m);
    reduced = rc.platform == null || rc.reduced; reference = rc.platform;
  }
  const va = model.vstar(r.any, m).value;
  const viirsLevel = va != null ? va : value == null || modisToViirsByMoy[moy(m)] == null ? null : value * modisToViirsByMoy[moy(m)];
  regionSeries[m] = { cls, value: value == null ? null : +value.toFixed(3), lo: value == null || !iv ? value : +(value * iv.lo).toFixed(3), hi: value == null || !iv ? value : +(value * iv.hi).toFixed(3), viirsLevel: viirsLevel == null ? null : +viirsLevel.toFixed(3), viirsObserved: va != null, reduced, reference };
}

// ---- 4. drift diagnostic: observed MODIS vs VIIRS-estimated after training ---
// Months with incomplete MODIS or VIIRS-reference coverage are left out.
const drift = [];
for (const y of [...new Set(months.map(year))].filter((y) => y > T1).sort()) {
  let o = 0, e = 0, used = 0, skipped = 0;
  for (const m of months.filter((x) => year(x) === y)) {
    const rc = model.vstar(regionMonth(m).any, m);
    if (modisLoss(m) || rc.platform == null || rc.reduced) { skipped++; continue; }
    const est = selected === "qm" ? estQm(model, m, fOf(m)) : estStrat(model, m);
    if (est == null) continue;
    o += regionMonth(m).any.M; e += est; used++;
  }
  drift.push({ year: y, months: used, monthsSkippedForCoverage: skipped, modisObserved: o, viirsEstimated: Math.round(e), observedOverEstimated: e ? o / e : null });
}

// ---- outputs ------------------------------------------------------------------
const serial = (t) => Object.fromEntries([...t].map(([k, v]) => [k, { k: v.k == null ? null : +v.k.toFixed(6), m: v.m, v: +v.v.toFixed(1), n: v.n }]));
const SELECTION_RULE = "Quantile mapping if its leave-one-year-out monthly MAE is strictly lower than the stratified ratio's; otherwise the stratified ratio. Written down before the v2 fits but after the v1 Iberia results had been seen (not pre-registered in the strict sense). The same held-out errors choose and describe the method; the nested score (selection repeated inside each outer fold) estimates the whole procedure without that reuse.";
const calibration = {
  method: METHOD_VERSION,
  region: regionId,
  inputManifestSha256: sha(readFileSync(join(DIR, "manifest.json"))),
  trainingYears: [T0, T1], trainingYearsWithData: trainYears, kappa: KAPPA,
  periods: PERIODS,
  periodRule: { "terra-only-estimated": "before Aqua: Terra-only MODIS x Terra->Terra∪Aqua factor", "modis-observed": "MODIS Terra∪Aqua as observed", "viirs-estimated": selected === "qm" ? "region: quantile mapping of the VIIRS reference (day + night) to MODIS any-time; AOI: region estimate x AOI share of the VIIRS reference" : "VIIRS reference x stratified MODIS/VIIRS ratio (day, night) combined with overlap factor rho" },
  selection: {
    selected,
    rule: SELECTION_RULE,
    looMonthlyMae: { stratified: +summary.proposed.mae.toFixed(2), qm: +summary.qm.mae.toFixed(2), global: +summary.global.mae.toFixed(2) },
    nested: nestedMetrics ? { mae: +nestedMetrics.mae.toFixed(2), chosen: nested.chosen } : null,
  },
  viirsCover: cover, crossCalibration: model.cross,
  rho: model.rho,
  viirsToModis: serial(model.table),
  terraToModis: serial(terraTable),
  qm: { x: model.qm.v.map((x) => +x.toFixed(4)), m: model.qm.m, basis: "x = VIIRS reference day + night cell-days (S-NPP scale), m = MODIS any-time cell-days, whole-region training months with complete coverage" },
  interval90: intervals ? { lo: +intervals.lo.toFixed(4), hi: +intervals.hi.toFixed(4), outOfSampleCoverage: +intervals.coverage.toFixed(3), n: intervals.n, note: "Multiplicative bounds from held-out (leave-one-year-out, all parameters refitted per fold) residuals of the selected method, region-scale monthly totals; small AOIs add Poisson sampling noise (z·sqrt(estimate))." } : null,
  terraInterval90: terraInterval ? { lo: +terraInterval.lo.toFixed(4), hi: +terraInterval.hi.toFixed(4), outOfSampleCoverage: +terraInterval.coverage.toFixed(3), n: terraInterval.n } : null,
  viirsLevel: { basis: "VIIRS reference any-time cell-days on the S-NPP scale where a full VIIRS month exists; otherwise MODIS-equivalent x training ratio for the month of year (estimated)", modisToViirsByMoy },
  coverage,
  coverageSensitivity: sensitivity,
  excludedMonths,
  aoiInterval,
  // Held-out evidence for the app's Evidence Lab (machine-generated; same numbers as <region>-validation.json).
  validation: {
    target: "observed MODIS (Terra ∪ Aqua) any-time fire-cell-days; not ground truth",
    heldOutMonths: loyo.stratified.map((r, i) => ({ month: r.month, year: r.year, observed: r.obs, stratified: +r.pred.toFixed(1), qm: +loyo.qm[i].pred.toFixed(1), global: +val.global.p[i].toFixed(1), rawSnpp: val.raw.p[i] })),
    metrics: Object.fromEntries(Object.entries(summary).map(([k, m]) => [k === "proposed" ? "stratified" : k, { n: m.n, mae: +m.mae.toFixed(2), rmse: +m.rmse.toFixed(2), bias: +m.bias.toFixed(2), r: +m.r.toFixed(4), ratio: +(m.totalPred / m.totalObs).toFixed(4) }])),
    nested: nestedMetrics ? { n: nestedMetrics.n, mae: +nestedMetrics.mae.toFixed(2), rmse: +nestedMetrics.rmse.toFixed(2), r: +nestedMetrics.r.toFixed(4), chosen: nested.chosen } : null,
    annual: annualBy,
    intervalByMethod: Object.fromEntries(Object.entries(intervalBy).map(([k, v]) => [k, v && { lo: +v.lo.toFixed(4), hi: +v.hi.toFixed(4), coverage: +v.coverage.toFixed(3), n: v.n }])),
    zone: zoneSummary,
    terraOnly: terraSummary ? { n: terraSummary.n, mae: +terraSummary.mae.toFixed(2), rmse: +terraSummary.rmse.toFixed(2), r: +terraSummary.r.toFixed(4), bias: +terraSummary.bias.toFixed(2) } : null,
    drift,
  },
  regionSeries,
};
writeFileSync(join(DIR, "calibration.json"), JSON.stringify(calibration, null, 1));
mkdirSync(join(ROOT, "data/processed/harmonize"), { recursive: true });
const validation = { method: METHOD_VERSION, region: regionId, selected, trainingYearsWithData: trainYears, excludedMonths, monthlyLOYO: summary, nestedLOYO: nestedMetrics ? { ...nestedMetrics, chosen: nested.chosen } : null, annualLOYO: annual, annualLOYOByMethod: annualBy, zoneLOYO: zoneSummary, zoneIntervalCoverage, zoneYears: zoneVal, terraOnlyLOYO: terraSummary, terraInterval90: calibration.terraInterval90, rho: model.rho, coefficientSummary: Object.fromEntries([...model.table].filter(([k]) => k.startsWith("*|")).map(([k, v]) => [k, +v.k.toFixed(4)])), terraCoefficientSummary: Object.fromEntries([...terraTable].filter(([k]) => k.startsWith("*|*")).map(([k, v]) => [k, +v.k.toFixed(4)])), interval90: calibration.interval90, interval90ByMethod: intervalBy, crossCalibration: model.cross, drift, coverageEvents: coverage.events, months: months.length };
writeFileSync(join(ROOT, "data/processed/harmonize", `${regionId}-validation.json`), JSON.stringify(validation, null, 1));
console.log(JSON.stringify({ selected, excludedMonths: Object.keys(excludedMonths).length, monthlyLOYO: summary, nestedLOYO: validation.nestedLOYO, annual, zoneLOYO: zoneSummary, zoneIntervalCoverage, interval90: calibration.interval90, interval90ByMethod: intervalBy, terraOnlyLOYO: terraSummary, terraInterval90: calibration.terraInterval90, cross: model.cross, drift, coverageEvents: coverage.events.length, confirmed: coverage.events.filter((e) => e.status === "confirmed").length }, null, 1));
