// Observation-coverage audit: which satellite was not observing on which day.
//
// Zero detections alone never mark a gap: fires can be absent, clouded or too
// small. A day is flagged only when another satellite that WAS observing saw
// enough fire that this one should have recorded many detections too
// (cross-satellite evidence), or, before any second satellite existed (Terra
// alone, 2000-11 to 2002-07), when the same days of year in every other year
// make zero detections over the whole region implausible (climatological
// evidence, stricter threshold). Documented NASA/NOAA notices
// (config/observation-events.json) only label a detected gap "confirmed";
// they never flag a day by themselves. Pure functions shared by
// scripts/harmonize/fit.mjs (which writes the result into calibration.json)
// and the browser.

export const COVERAGE_VERSION = "fcd-coverage-v1";
export const COV_PLATFORMS = ["Terra", "Aqua", "S-NPP", "NOAA-20", "NOAA-21"] as const;
export type CovPlatform = (typeof COV_PLATFORMS)[number];
const VIIRS_SET = new Set<CovPlatform>(["S-NPP", "NOAA-20", "NOAA-21"]);
export const isViirs = (p: CovPlatform) => VIIRS_SET.has(p);

export const COVERAGE_THRESHOLDS = {
  /** Expected detections (from the evidence) needed before a day can be judged at all. */
  minExpected: 100,
  /** Cross-satellite: observed / expected below this = gap (near-total loss). */
  gapRatio: 0.1,
  /** VIIRS vs VIIRS only: observed / expected below this = reduced (partial-day loss). 0.5 is below the 0.5th percentile of normal S-NPP/NOAA-20 day ratios. */
  reducedRatio: 0.5,
  /** Climatology (no second satellite): observed / expected below this = gap. */
  climatologyGapRatio: 0.02,
  /** Rolling window (± days) for the satellite-pair detection ratio. */
  ratioWindow: 45,
  /** Pairs need this many detections on each satellite to enter the ratio. */
  ratioMinDetections: 20,
  /** Minimum pairs in the window for a usable ratio. */
  ratioMinPairs: 15,
  /** Climatology: ± days of year, other years only. */
  climatologyWindow: 7,
  /** A month counts as reduced coverage for a satellite when it lost at least this share of the detections expected that month. */
  materialLoss: 0.05,
};

export type DayFlag = "gap" | "reduced";
export type DocumentedEvent = { id: string; platform: CovPlatform; start: string; end: string; kind: string; title: string; sources: string[]; verification?: { checked: string; status: string; note: string } };
export type CoverageEvent = {
  platform: CovPlatform;
  start: string;
  end: string;
  gapDays: number;
  reducedDays: number;
  status: "confirmed" | "suspected";
  evidence: Array<"cross-satellite" | "climatology" | "documented-zero">;
  documented: string[]; // DocumentedEvent ids
};
export type Coverage = {
  version: string;
  rule: string;
  thresholds: typeof COVERAGE_THRESHOLDS;
  operating: Partial<Record<CovPlatform, [string, string]>>;
  /** platform -> day -> flag (only flagged days are listed). */
  flagged: Partial<Record<CovPlatform, Record<string, DayFlag>>>;
  /** platform -> month -> share of the month's expected detections lost on flagged days (months with flagged days only). */
  monthLoss: Partial<Record<CovPlatform, Record<string, number>>>;
  events: CoverageEvent[];
  /** Documented notices with no loss visible in the records (data present or re-processed). */
  documentedWithoutDetectedLoss: string[];
  /** Days with zero detections that could not be judged (too little expected fire). Not flagged. */
  undeterminedZeroDays: Partial<Record<CovPlatform, number>>;
  inputs?: Array<{ region: string; path: string; sha256: string }>;
  /** The documented notices used for labelling (config/observation-events.json). */
  documented?: DocumentedEvent[];
};

export const COVERAGE_RULE =
  "A satellite-day is flagged only from the detection records: 'gap' when it recorded < 10% of the detections expected from another satellite observing the same day (expected = that satellite's detections x the median ratio between the two over the surrounding ±45 days; at least 100 expected), or, with no second satellite in orbit, < 2% of the median for the same days of year in other years; 'reduced' (VIIRS only, judged against another VIIRS) when < 50%. Days with fewer than 100 expected detections are not judged from the data alone; on those days zero detections inside a documented outage notice are flagged as a gap (documented + zero). A month is reduced coverage for a satellite when its flagged days lost >= 5% of the detections expected that month. A flagged run is 'confirmed' when it overlaps a documented NASA/NOAA outage notice, otherwise 'suspected'.";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const t0 = (d: string) => Date.parse(`${d}T00:00:00Z`);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * Detect observation gaps from daily detections per satellite.
 * `daily`: day -> detections in COV_PLATFORMS order (summed over all published
 * regions: outages are spacecraft-wide). `operating`: first/last day each
 * satellite produced data (pre-launch and post-end days are never "gaps").
 */
export function detectCoverage(
  daily: Map<string, number[]>,
  operating: Partial<Record<CovPlatform, [string, string]>>,
  documented: DocumentedEvent[] = [],
  th = COVERAGE_THRESHOLDS,
): Coverage {
  const days = [...daily.keys()].sort();
  if (!days.length) return { version: COVERAGE_VERSION, rule: COVERAGE_RULE, thresholds: th, operating, flagged: {}, monthLoss: {}, events: [], documentedWithoutDetectedLoss: documented.map((d) => d.id), undeterminedZeroDays: {} };
  // Dense day axis (days without rows have zero detections everywhere).
  const start = t0(days[0]), n = Math.round((t0(days.at(-1)!) - start) / DAY) + 1;
  const axis = Array.from({ length: n }, (_, i) => iso(start + i * DAY));
  const det = COV_PLATFORMS.map((_, j) => axis.map((d) => daily.get(d)?.[j] ?? 0));
  const on = COV_PLATFORMS.map((p) => { const w = operating[p]; return axis.map((d) => !!w && d >= w[0] && d <= w[1]); });

  // Rolling median detection ratio P/Q (pairs that look like a gap of either are left out).
  const ratioCache = new Map<string, Float64Array>();
  const ratio = (i: number, j: number) => {
    const key = `${i}|${j}`;
    let r = ratioCache.get(key);
    if (r) return r;
    r = new Float64Array(n).fill(NaN);
    const pairs = new Float64Array(n).fill(NaN);
    for (let k = 0; k < n; k++) {
      const a = det[i][k], b = det[j][k];
      if (on[i][k] && on[j][k] && a >= th.ratioMinDetections && b >= th.ratioMinDetections) pairs[k] = a / b;
    }
    for (let k = 0; k < n; k++) {
      const w: number[] = [];
      for (let q = Math.max(0, k - th.ratioWindow); q <= Math.min(n - 1, k + th.ratioWindow); q++) if (!Number.isNaN(pairs[q])) w.push(pairs[q]);
      if (w.length < th.ratioMinPairs) continue;
      const m = median(w); // first pass, then drop outliers that look like losses of either satellite
      const kept = w.filter((x) => x > 0.2 * m && x < 5 * m);
      r[k] = kept.length >= th.ratioMinPairs ? median(kept) : m;
    }
    ratioCache.set(key, r);
    return r;
  };

  const flagged: Coverage["flagged"] = {};
  const evidenceOf = new Map<string, CoverageEvent["evidence"][number]>();
  const expected = COV_PLATFORMS.map(() => new Float64Array(n).fill(NaN));
  const undetermined: Coverage["undeterminedZeroDays"] = {};
  COV_PLATFORMS.forEach((p, i) => {
    const out: Record<string, DayFlag> = {};
    const same = COV_PLATFORMS.map((q, j) => j).filter((j) => j !== i && isViirs(COV_PLATFORMS[j]) === isViirs(p));
    const other = COV_PLATFORMS.map((q, j) => j).filter((j) => isViirs(COV_PLATFORMS[j]) !== isViirs(p));
    for (let k = 0; k < n; k++) {
      if (!on[i][k]) continue;
      const obs = det[i][k];
      // Same-sensor peers observing today; other sensor only when none exist.
      const live = same.filter((j) => on[j][k]);
      const peers = live.length ? live : other.filter((j) => on[j][k]);
      const sameSensor = live.length > 0;
      const exp: number[] = [];
      for (const j of peers) {
        if (det[j][k] <= 0) continue; // a dark peer gives no evidence
        const r = ratio(i, j)[k];
        if (Number.isFinite(r)) exp.push(det[j][k] * r);
      }
      let flag: DayFlag | null = null, ev: "cross-satellite" | "climatology" | null = null;
      if (exp.length) {
        const e = median(exp);
        expected[i][k] = e;
        if (e < th.minExpected) { if (obs === 0) undetermined[p] = (undetermined[p] ?? 0) + 1; continue; }
        const s = obs / e;
        if (s < th.gapRatio) flag = "gap";
        else if (isViirs(p) && sameSensor && s < th.reducedRatio) flag = "reduced";
        ev = "cross-satellite";
      } else if (!peers.length) {
        // No other satellite in orbit: climatology of this satellite in other years.
        const d = axis[k], doy = Math.round((t0(d) - Date.UTC(+d.slice(0, 4), 0, 1)) / DAY), yr = +d.slice(0, 4);
        const hist: number[] = [];
        for (let q = 0; q < n; q++) {
          if (!on[i][q] || +axis[q].slice(0, 4) === yr) continue;
          const dq = axis[q], doyq = Math.round((t0(dq) - Date.UTC(+dq.slice(0, 4), 0, 1)) / DAY);
          const dd = Math.min(Math.abs(doyq - doy), 365 - Math.abs(doyq - doy));
          if (dd <= th.climatologyWindow) hist.push(det[i][q]);
        }
        const e = hist.length >= 30 ? median(hist) : NaN;
        expected[i][k] = e;
        if (!(e >= th.minExpected)) { if (obs === 0) undetermined[p] = (undetermined[p] ?? 0) + 1; continue; }
        if (obs / e < th.climatologyGapRatio) flag = "gap";
        ev = "climatology";
      } else if (obs === 0) undetermined[p] = (undetermined[p] ?? 0) + 1;
      if (flag) { out[axis[k]] = flag; evidenceOf.set(`${p}|${axis[k]}`, ev!); }
    }
    // Documented outage + zero detections: flagged even where the data alone cannot judge.
    for (const doc of documented) {
      if (doc.platform !== p || doc.kind !== "outage") continue;
      for (let k = 0; k < n; k++) {
        const d = axis[k];
        if (d < doc.start || d > doc.end || !on[i][k] || out[d] || det[i][k] !== 0) continue;
        out[d] = "gap";
        evidenceOf.set(`${p}|${d}`, "documented-zero");
      }
    }
    if (Object.keys(out).length) flagged[p] = out;
  });

  // Share of each month's expected detections lost on flagged days.
  const monthLoss: Coverage["monthLoss"] = {};
  COV_PLATFORMS.forEach((p, i) => {
    const f = flagged[p];
    if (!f) return;
    const obs = new Map<string, number>(), lost = new Map<string, number>();
    for (let k = 0; k < n; k++) {
      if (!on[i][k]) continue;
      const m = axis[k].slice(0, 7);
      obs.set(m, (obs.get(m) ?? 0) + det[i][k]);
      if (f[axis[k]]) {
        const e = expected[i][k];
        lost.set(m, (lost.get(m) ?? 0) + (Number.isFinite(e) ? Math.max(0, e - det[i][k]) : 0));
      }
    }
    const out: Record<string, number> = {};
    for (const d of Object.keys(f)) {
      const m = d.slice(0, 7), l = lost.get(m) ?? 0, o = obs.get(m) ?? 0;
      out[m] = l + o > 0 ? +(l / (l + o)).toFixed(4) : 0;
    }
    monthLoss[p] = out;
  });

  // Runs of consecutive flagged days -> events, labelled by documented notices.
  const events: CoverageEvent[] = [];
  const matched = new Set<string>();
  for (const p of COV_PLATFORMS) {
    const f = flagged[p];
    if (!f) continue;
    const ds = Object.keys(f).sort();
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      const s = run[0], e = run.at(-1)!;
      const docs = documented.filter((d) => d.platform === p && d.start <= iso(t0(e) + DAY) && d.end >= iso(t0(s) - DAY)).map((d) => d.id);
      docs.forEach((id) => matched.add(id));
      const ev = [...new Set(run.map((d) => evidenceOf.get(`${p}|${d}`)!))];
      events.push({ platform: p, start: s, end: e, gapDays: run.filter((d) => f[d] === "gap").length, reducedDays: run.filter((d) => f[d] === "reduced").length, status: docs.length ? "confirmed" : "suspected", evidence: ev, documented: docs });
      run = [];
    };
    for (const d of ds) {
      if (run.length && t0(d) - t0(run.at(-1)!) !== DAY) flush();
      run.push(d);
    }
    flush();
  }
  return {
    version: COVERAGE_VERSION,
    rule: COVERAGE_RULE,
    thresholds: th,
    operating,
    flagged,
    monthLoss,
    events,
    documentedWithoutDetectedLoss: documented.filter((d) => !matched.has(d.id)).map((d) => d.id),
    undeterminedZeroDays: undetermined,
  };
}

// Sorted flagged days per satellite, cached per coverage object (called per zone, overpass and month).
const sortedIndex = new WeakMap<Coverage, Partial<Record<CovPlatform, string[]>>>();
const lowerBound = (a: string[], x: string) => { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; } return lo; };

/** Flagged days of a satellite in [first, last] (inclusive ISO days). */
export function flaggedDays(cov: Coverage | undefined, p: CovPlatform, first: string, last: string, only?: DayFlag): number {
  const f = cov?.flagged[p];
  if (!cov || !f) return 0;
  if (only) { let k = 0; for (const [d, flag] of Object.entries(f)) if (d >= first && d <= last && flag === only) k++; return k; }
  let idx = sortedIndex.get(cov);
  if (!idx) sortedIndex.set(cov, (idx = {}));
  const a = (idx[p] ??= Object.keys(f).sort());
  return lowerBound(a, `${last}￿`) - lowerBound(a, first);
}

/** Whether a satellite was producing data for all, part or none of [first, last]. */
export function operatingIn(cov: Coverage | undefined, p: CovPlatform, first: string, last: string): "full" | "partial" | "none" {
  const w = cov?.operating[p];
  if (!w || w[0] > last || w[1] < first) return "none";
  return w[0] <= first && w[1] >= last ? "full" : "partial";
}

/** Share of a month's expected detections a satellite lost (0 when nothing was flagged). */
export const monthLossOf = (cov: Coverage | undefined, p: CovPlatform, month: string) => cov?.monthLoss?.[p]?.[month] ?? 0;
/** Reduced coverage: the satellite lost a material share (>= thresholds.materialLoss) of the month's expected detections. */
export const materialLoss = (cov: Coverage | undefined, p: CovPlatform, month: string) =>
  monthLossOf(cov, p, month) >= (cov?.thresholds.materialLoss ?? COVERAGE_THRESHOLDS.materialLoss);

export const dayFlag = (cov: Coverage | undefined, p: CovPlatform, day: string): DayFlag | null => cov?.flagged[p]?.[day] ?? null;
