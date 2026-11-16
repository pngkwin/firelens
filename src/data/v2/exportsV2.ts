// Exports for the harmonized calendar: monthly CSV, provenance JSON, and AOI
// filtering of the backend's point CSV.
import { PLATFORMS } from "./codec";
import { COV_PLATFORMS, type Coverage } from "./coverage";
import { monthStatus } from "./analysis";
import { METHOD_VERSION } from "./harmonize";
import type { MonthResult } from "./series";
import type { HistoryComparison } from "./stats";

/**
 * Spreadsheet formula-injection guard: a non-numeric value starting with
 * = + - @ tab or CR gets a leading apostrophe. Numbers (including negative
 * longitudes such as -120.5) are left unchanged.
 */
export const guardFormula = (s: string) => (/^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s)) ? `'${s}` : s);
const csvCell = (v: unknown) => {
  const s = typeof v === "number" ? String(v) : guardFormula(v == null ? "" : String(v));
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const num = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(digits));

export const ESTIMATE_LABEL: Record<string, string> = {
  observed: "observed MODIS (Terra ∪ Aqua)",
  "terra-scaling": "ESTIMATED: Terra-only MODIS scaled to Terra ∪ Aqua",
  stratified: "ESTIMATED from VIIRS: stratified ratio",
  qm: "ESTIMATED from VIIRS: quantile mapping",
};

export const MONTHLY_COLUMNS = [
  "month", "period_class", "modis_eq_source", "method_version",
  "modis_eq_fire_cell_days", "modis_eq_lo90", "modis_eq_hi90",
  "viirs_level_fire_cell_days", "viirs_level_estimated", "viirs_reference_platform",
  "raw_any_sensor", "raw_modis", "raw_terra", "raw_aqua", "raw_viirs", "raw_snpp", "raw_noaa20", "raw_noaa21",
  ...PLATFORMS.map((p) => `detections_${p.toLowerCase().replace("-", "")}`),
  ...PLATFORMS.map((p) => `frp_sum_mw_${p.toLowerCase().replace("-", "")}`),
  "days_covered", "days_in_month",
  // Observation coverage: "reduced" = the MODIS-equivalent value rests on a satellite with a material outage (lower bound, no anomaly);
  // satellite_outages lists flagged days and the share of expected detections lost per satellite. Empty raw/per-platform cells = satellite not in orbit.
  "modis_eq_coverage", "satellite_outages",
  // Anomaly of modis_eq vs the same month in all other complete years (partial months: whole-month values, see month-to-date in the app).
  "same_month_years", "same_month_median", "same_month_mean", "pct_of_median", "pct_of_mean", "z_score", "percentile",
] as const;

/** Empty when a satellite produced no data that month (not in orbit yet, or ended); zero = no matching records. */
const opv = (r: MonthResult, p: (typeof COV_PLATFORMS)[number], v: number | string) => (r.coverage.operating[p] === "none" ? "" : v);
const anyOn = (r: MonthResult, ps: readonly (typeof COV_PLATFORMS)[number][]) => ps.some((p) => r.coverage.operating[p] !== "none");
const VI = ["S-NPP", "NOAA-20", "NOAA-21"] as const;
const outages = (r: MonthResult) => COV_PLATFORMS.filter((p) => r.coverage.flaggedDays[p] > 0).map((p) => `${p} ${r.coverage.flaggedDays[p]} d (${(100 * r.coverage.loss[p]).toFixed(1)}% lost)`).join("; ");

/** One row per month. Zero = no matching records in the loaded data; empty = not observed (satellite not in orbit). */
export function monthlyCsv(results: MonthResult[], anomalies?: Map<string, HistoryComparison | null>): string {
  const rows = results.map((r) => [
    r.month, r.cls, ESTIMATE_LABEL[r.method], METHOD_VERSION,
    num(r.value), r.cls === "modis-observed" ? "" : num(r.lo), r.cls === "modis-observed" ? "" : num(r.hi),
    num(r.viirsLevel), r.viirsLevelEstimated ? "yes" : "no", r.viirsPlatform ?? "",
    r.raw.any.ALL, r.raw.any.M, opv(r, "Terra", r.raw.any.Terra), opv(r, "Aqua", r.raw.any.Aqua), anyOn(r, VI) ? r.raw.any.V : "", opv(r, "S-NPP", r.raw.any["S-NPP"]), opv(r, "NOAA-20", r.raw.any["NOAA-20"]), opv(r, "NOAA-21", r.raw.any["NOAA-21"]),
    ...r.det.map((v, i) => opv(r, COV_PLATFORMS[i], v)), ...r.frp.map((v, i) => opv(r, COV_PLATFORMS[i], num(v))),
    r.daysCovered, r.daysInMonth,
    monthStatus(r, "modis-eq").reduced ? "reduced" : "full", outages(r),
    ...anomalyCols(anomalies?.get(r.month) ?? null),
  ]);
  return [MONTHLY_COLUMNS.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

const anomalyCols = (a: HistoryComparison | null) =>
  a ? [a.n, num(a.median), num(a.mean), num(a.pctOfMedian), num(a.pctOfMean), num(a.z, 2), num(a.percentile)] : ["", "", "", "", "", "", ""];

/** Keep only rows of a FIRMS point CSV whose location is inside the AOI. */
export function filterPointsCsv(csv: string, inside: (lon: number, lat: number) => boolean): { csv: string; kept: number; total: number } {
  const lines = csv.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { csv: "", kept: 0, total: 0 };
  const header = lines[0].split(",");
  const iLat = header.indexOf("latitude"), iLon = header.indexOf("longitude");
  if (iLat < 0 || iLon < 0) throw Error("Point CSV has no latitude/longitude columns.");
  // Re-emitted lines get the formula guard on each field (the backend guards too; this covers older deployments).
  // Lines with quoted fields are left as they are, because splitting on "," would break the quoting.
  const kept = lines
    .slice(1)
    .filter((l) => { const f = l.split(","); return inside(+f[iLon], +f[iLat]); })
    .map((l) => (l.includes('"') ? l : l.split(",").map(guardFormula).join(",")));
  return { csv: [lines[0], ...kept].join("\n") + "\n", kept: kept.length, total: lines.length - 1 };
}

export type ProvenanceInput = {
  region: string;
  aoi: { encoded: string; label: string; cellRule: string; geometry: unknown };
  range: { from: string; to: string };
  scale: string;
  manifestSha256: string;
  manifestUrl: string;
  planEnd: string;
  calibrationSha256: string;
  selection: { selected: string; rule: string; looMonthlyMae: Record<string, number> };
  interval90: unknown;
  terraInterval90: unknown;
  coverage?: Coverage;
  filesUsed: Array<{ path: string; sha256: string }>;
  live: { configured: boolean; days: Array<{ day: string; fetchedAt: number; provisional: boolean; sources: string[] }> } | null;
  zeroMeaning: string;
  areaCaveat: string;
  url: string;
};

export function provenance({ coverage, ...p }: ProvenanceInput, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    product: "FireLens harmonized MODIS/VIIRS fire calendar",
    unit: "fire-cell-day: one H3 resolution-8 cell (~0.74 km²) on one UTC day with at least one detection; sensors combined as a union, never a sum",
    methodVersion: METHOD_VERSION,
    methodDocs: ["docs/harmonization-method.md", "docs/harmonization-validation.md"],
    ...p,
    periods: {
      "terra-only-estimated": "before 2002-07: Terra-only MODIS scaled to Terra ∪ Aqua (estimated)",
      "modis-observed": "2002-07 to 2021-12: MODIS Terra ∪ Aqua as observed",
      "viirs-estimated": "from 2022-01: MODIS-equivalent estimated from VIIRS (MODIS orbit drift)",
    },
    sources: "NASA FIRMS: MODIS C6.1 (Terra, Aqua), VIIRS 375 m (S-NPP to 2026-11-02, NOAA-20, NOAA-21); science-quality where available, near-real-time after",
    observationCoverage: coverage ? {
      version: coverage.version,
      rule: coverage.rule,
      operating: coverage.operating,
      outages: coverage.events.map((e) => ({ platform: e.platform, start: e.start, end: e.end, gapDays: e.gapDays, reducedDays: e.reducedDays, status: e.status, evidence: e.evidence, documented: e.documented })),
      documentedEventsFile: "config/observation-events.json",
      note: "Flagged satellite-days are never treated as zero fire. A month whose MODIS-equivalent source lost >= 5% of its expected detections is marked reduced (lower bound) and excluded from anomalies, baselines and trends.",
    } : null,
  };
}
