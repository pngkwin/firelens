// Exports for the harmonized calendar: monthly CSV, provenance JSON, and AOI
// filtering of the backend's point CSV.
import { PLATFORMS } from "./codec";
import { METHOD_VERSION } from "./harmonize";
import type { MonthResult } from "./series";
import type { HistoryComparison } from "./stats";

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
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
  // Anomaly of modis_eq vs the same month in all other complete years (partial months: whole-month values, see month-to-date in the app).
  "same_month_years", "same_month_median", "same_month_mean", "pct_of_median", "pct_of_mean", "z_score", "percentile",
] as const;

/** One row per month. Zero = no matching records in the loaded data. */
export function monthlyCsv(results: MonthResult[], anomalies?: Map<string, HistoryComparison | null>): string {
  const rows = results.map((r) => [
    r.month, r.cls, ESTIMATE_LABEL[r.method], METHOD_VERSION,
    num(r.value), r.cls === "modis-observed" ? "" : num(r.lo), r.cls === "modis-observed" ? "" : num(r.hi),
    num(r.viirsLevel), r.viirsLevelEstimated ? "yes" : "no", r.viirsPlatform ?? "",
    r.raw.any.ALL, r.raw.any.M, r.raw.any.Terra, r.raw.any.Aqua, r.raw.any.V, r.raw.any["S-NPP"], r.raw.any["NOAA-20"], r.raw.any["NOAA-21"],
    ...r.det, ...r.frp.map((v) => num(v)),
    r.daysCovered, r.daysInMonth,
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
  const kept = lines.slice(1).filter((l) => { const f = l.split(","); return inside(+f[iLon], +f[iLat]); });
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
  filesUsed: Array<{ path: string; sha256: string }>;
  live: { configured: boolean; days: Array<{ day: string; fetchedAt: number; provisional: boolean; sources: string[] }> } | null;
  zeroMeaning: string;
  areaCaveat: string;
  url: string;
};

export function provenance(p: ProvenanceInput, now = new Date()) {
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
  };
}
