// Test helpers: nominal satellite coverage (no flagged gaps), using the real
// first-data dates of each satellite in the bundle. Imported by tests only.
import { monthCoverage, type MonthCoverage } from "./series";
import { COVERAGE_RULE, COVERAGE_THRESHOLDS, COVERAGE_VERSION, type Coverage } from "./coverage";

export const NOMINAL_COVERAGE: Coverage = {
  version: COVERAGE_VERSION,
  rule: COVERAGE_RULE,
  thresholds: COVERAGE_THRESHOLDS,
  operating: { Terra: ["2000-11-01", "2026-11-14"], Aqua: ["2002-07-04", "2026-11-14"], "S-NPP": ["2012-01-20", "2026-11-02"], "NOAA-20": ["2018-04-01", "2026-11-14"], "NOAA-21": ["2023-03-01", "2026-11-14"] },
  flagged: {},
  monthLoss: {},
  events: [],
  documentedWithoutDetectedLoss: [],
  undeterminedZeroDays: {},
};
const last = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
export const coverageOf = (month: string, cov: Coverage = NOMINAL_COVERAGE): MonthCoverage => monthCoverage(cov, month, last(month) < "2026-11-14" ? last(month) : "2026-11-14");
/** Coverage fields of a MonthResult with no flagged gaps. */
export const okMonth = (month: string) => ({ coverage: coverageOf(month), reduced: false, viirsReduced: false });
