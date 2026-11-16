import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { Calibration } from "../data/v2/bundle";
import { REGIONS, type RegionId } from "../data/v2/urlState";
import { fmt, monthLabel } from "./colors";
import { download } from "./png";

type Props = { cal: Calibration; calSha: string; region: RegionId; onFocus: (m: string) => void };
const METHOD_NAME: Record<string, string> = { stratified: "Stratified ratio (zone × month × day/night)", qm: "Quantile mapping", global: "Single global ratio", raw: "Raw S-NPP, no calibration" };
const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "–" : `${(100 * x).toFixed(d)}%`);

/** Held-out validation of the harmonization, from calibration.json (written by scripts/harmonize/fit.mjs). */
export function EvidenceLab({ cal, calSha, region, onFocus }: Props) {
  const v = cal.validation;
  const sel = cal.selection.selected;
  const iv = cal.interval90;
  const pts = useMemo(() => (v ? v.heldOutMonths.map((h) => ({ month: h.month, observed: h.observed, predicted: h[sel], band: iv ? [h[sel] * iv.lo, h[sel] * iv.hi] : null })) : []), [v, sel, iv]);
  const max = Math.max(1, ...pts.flatMap((p) => [p.observed, p.predicted]));
  const switches = useMemo(() => Object.entries(cal.regionSeries).filter(([m, s]) => s.cls === "viirs-estimated" && s.reference && s.reference !== "S-NPP" && m <= (cal.viirsCover["S-NPP"]?.[1] ?? "") && m < (cal.viirsCover["S-NPP"]?.[1] ?? "").slice(0, 7)).map(([m, s]) => ({ month: m, reference: s.reference! })), [cal]);
  if (!v) return <section className="fc-panel"><p className="fc-note">This calibration has no published validation block; refit with scripts/harmonize/fit.mjs.</p></section>;
  const docs = new Map((cal.coverage.documented ?? []).map((d) => [d.id, d]));
  const ai = cal.aoiInterval;
  const csv = () => ["month,year,observed_modis,predicted_stratified,predicted_quantile_mapping,predicted_global_ratio,raw_snpp,selected_method", ...v.heldOutMonths.map((h) => [h.month, h.year, h.observed, h.stratified, h.qm, h.global, h.rawSnpp, sel].join(","))].join("\n") + "\n";
  const json = () => JSON.stringify({ region, method: cal.method, calibrationSha256: calSha, inputManifestSha256: cal.inputManifestSha256, selection: cal.selection, interval90: cal.interval90, terraInterval90: cal.terraInterval90, aoiInterval: cal.aoiInterval, crossCalibration: cal.crossCalibration, excludedMonths: cal.excludedMonths, validation: v, coverageEvents: cal.coverage.events, coverageSensitivity: cal.coverageSensitivity, generator: "scripts/harmonize/fit.mjs" }, null, 1);
  return (
    <section className="fc-panel" aria-labelledby="fc-lab-title">
      <div className="fc-panel-head">
        <h2 id="fc-lab-title">Harmonization evidence lab: {REGIONS[region]}</h2>
        <p className="fc-sub">
          Each year {cal.trainingYearsWithData[0]}–{cal.trainingYearsWithData.at(-1)} is predicted from VIIRS by a model refitted without that year (all parameters), and compared with the MODIS that was actually observed. <strong>This tests whether the MODIS scale can be reproduced from VIIRS; it is not a comparison with fires on the ground.</strong> Region-scale monthly totals; {v.heldOutMonths.length} held-out months.
        </p>
      </div>
      <div className="fc-table-scroll">
        <table className="fc-table">
          <caption>Held-out monthly error by method (fire-cell-days per month; mean observed month {fmt(v.heldOutMonths.reduce((s, h) => s + h.observed, 0) / v.heldOutMonths.length)})</caption>
          <thead><tr><th scope="col">Method</th><th scope="col" className="num">n</th><th scope="col" className="num">MAE</th><th scope="col" className="num">RMSE</th><th scope="col" className="num">Bias</th><th scope="col" className="num">r</th><th scope="col" className="num">Σ pred / Σ obs</th></tr></thead>
          <tbody>
            {(["raw", "global", "qm", "stratified"] as const).map((k) => { const m = v.metrics[k]; return m && (
              <tr key={k} className={k === sel ? "fc-selected" : ""}><td>{METHOD_NAME[k]}{k === sel && <span className="fc-badge small">selected</span>}</td><td className="num">{m.n}</td><td className="num">{fmt(m.mae)}</td><td className="num">{fmt(m.rmse)}</td><td className="num">{fmt(m.bias, 1)}</td><td className="num">{fmt(m.r, 3)}</td><td className="num">{fmt(m.ratio, 3)}</td></tr>
            ); })}
            {v.nested && <tr><td>Nested: method chosen inside each held-out year</td><td className="num">{v.nested.n}</td><td className="num">{fmt(v.nested.mae)}</td><td className="num">{fmt(v.nested.rmse)}</td><td className="num">–</td><td className="num">{fmt(v.nested.r, 3)}</td><td className="num">–</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="fc-note">{cal.selection.rule} {v.nested && `The nested run chose ${[...new Set(Object.values(v.nested.chosen))].map((m) => METHOD_NAME[m] ?? m).join(" / ")} in every outer year.`}</p>
      <div className="fc-two-inner">
        <figure className="fc-figure">
          <figcaption>Observed vs predicted (held out), with the 1:1 line</figcaption>
          <div className="fc-chart" role="img" aria-label="Scatter of observed MODIS against held-out predictions; data in the download">
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 8 }} accessibilityLayer={false}>
                <CartesianGrid stroke="#d9e2dc" />
                <XAxis type="number" dataKey="predicted" name="Predicted" domain={[0, max]} tick={{ fontSize: 11 }} tickFormatter={(x: number) => fmt(x)} label={{ value: "predicted MODIS-equivalent", fontSize: 11, position: "insideBottom", offset: -8 }} />
                <YAxis type="number" dataKey="observed" name="Observed" domain={[0, max]} tick={{ fontSize: 11 }} tickFormatter={(x: number) => fmt(x)} width={56} />
                <ZAxis range={[18, 18]} />
                <Tooltip formatter={(x) => fmt(Number(x))} labelFormatter={() => ""} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="#b54c20" strokeDasharray="4 3" />
                <Scatter data={pts} fill="#173e36" isAnimationActive={false} onClick={(p) => { const m = (p as unknown as { payload?: { month?: string } }).payload?.month; if (m) onFocus(m); }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </figure>
        <figure className="fc-figure">
          <figcaption>Held-out months: observed MODIS inside the predicted 90% interval?</figcaption>
          <div className="fc-chart" role="img" aria-label="Held-out monthly predictions with 90% interval band and observed MODIS">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={pts} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} accessibilityLayer={false}>
                <CartesianGrid stroke="#d9e2dc" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={11} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(x: number) => fmt(x)} width={56} />
                <Tooltip formatter={(x) => (Array.isArray(x) ? `${fmt(Number(x[0]))}–${fmt(Number(x[1]))}` : fmt(Number(x)))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area dataKey="band" name="90% interval" stroke="none" fill="#9fb8ad" fillOpacity={0.5} isAnimationActive={false} />
                <Line dataKey="predicted" name="Predicted" stroke="#2a6f97" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line dataKey="observed" name="Observed MODIS" stroke="#173e36" strokeWidth={0} dot={{ r: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </figure>
      </div>
      <h3 className="fc-h3">Uncertainty: do the 90% intervals hold?</h3>
      <div className="fc-table-scroll">
        <table className="fc-table">
          <caption>Empirical coverage of nominal 90% intervals on held-out data</caption>
          <thead><tr><th scope="col">Scale</th><th scope="col">Interval</th><th scope="col" className="num">n</th><th scope="col" className="num">Coverage</th></tr></thead>
          <tbody>
            {iv && <tr><td>Whole region, monthly (estimated months)</td><td>×[{fmt(iv.lo, 3)}, {fmt(iv.hi, 3)}]</td><td className="num">{iv.n}</td><td className="num">{pct(iv.outOfSampleCoverage)}</td></tr>}
            {cal.terraInterval90 && <tr><td>Terra-only era scaling</td><td>×[{fmt(cal.terraInterval90.lo, 3)}, {fmt(cal.terraInterval90.hi, 3)}]</td><td className="num">{cal.terraInterval90.n}</td><td className="num">{pct(cal.terraInterval90.outOfSampleCoverage)}</td></tr>}
            {ai && Object.entries(ai.outOfSample.before.byPredictedSize).map(([band, b]) => (
              <tr key={band}><td>Zones (~600,000 km²), predicted {band} cell-days/month</td><td>region interval ± 1.645·√v → ± 1.645·{fmt(ai.factor, 2)}·√v</td><td className="num">{b.zoneMonths}</td><td className="num">{pct(b.coverage)} → <strong>{pct(ai.outOfSample.after.byPredictedSize[band]?.coverage)}</strong></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {ai && <p className="fc-note">Small-area intervals were too narrow: the Poisson sampling term assumed independent cell-days, but fire clusters. The app now widens it by a factor of {fmt(ai.factor, 2)}, chosen on other years and scored on each held-out year (out-of-sample coverage {pct(ai.outOfSample.before.all)} → {pct(ai.outOfSample.after.all)} over all held-out zone-months). Validated at zone scale only: areas much smaller than a zone (most states, drawn polygons) are not validated separately.</p>}
      {ai && <p className="fc-note">How this coverage was evaluated: {Object.values(ai.outOfSample.after.byPredictedSize).reduce((s, b) => s + b.zoneMonths, 0).toLocaleString("en-US")} zone-months from the training years {cal.trainingYears?.[0] ?? 2012}–{cal.trainingYears?.[1] ?? 2021}, each predicted by the method fitted without its year (leave-one-year-out), with the factor also chosen without that year (per-year factors {fmt(Math.min(...Object.values(ai.perHeldOutYear)), 2)}–{fmt(Math.max(...Object.values(ai.perHeldOutYear)), 2)}); a hit means observed MODIS fell inside the interval. Limits: the target is observed MODIS, not ground truth; the region-scale multiplicative band ×[{fmt(iv?.lo, 3)}, {fmt(iv?.hi, 3)}] used inside this check was fitted on all training years (a small in-sample component); zone-months of the same year are correlated, so the effective sample is smaller than the count; coverage is pooled, so individual zones or seasons can be lower.</p>}
      <div className="fc-two-inner">
        <div className="fc-table-scroll">
          <table className="fc-table">
            <caption>Held-out annual totals ({METHOD_NAME[sel]})</caption>
            <thead><tr><th scope="col">Year</th><th scope="col" className="num">Observed</th><th scope="col" className="num">Estimated</th><th scope="col" className="num">Ratio</th></tr></thead>
            <tbody>{v.annual[sel].map((a) => <tr key={a.year}><td>{a.year}</td><td className="num">{fmt(a.observed)}</td><td className="num">{fmt(a.estimated)}</td><td className="num">{fmt(a.ratio, 3)}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="fc-table-scroll">
          <table className="fc-table">
            <caption>After training: observed MODIS ÷ VIIRS-estimated (orbit drift)</caption>
            <thead><tr><th scope="col">Year</th><th scope="col" className="num">Months</th><th scope="col" className="num">Observed</th><th scope="col" className="num">Estimated</th><th scope="col" className="num">Ratio</th></tr></thead>
            <tbody>{v.drift.map((d) => <tr key={d.year}><td>{d.year}</td><td className="num">{d.months}{d.monthsSkippedForCoverage ? ` (+${d.monthsSkippedForCoverage} skipped)` : ""}</td><td className="num">{fmt(d.modisObserved)}</td><td className="num">{fmt(d.viirsEstimated)}</td><td className="num">{fmt(d.observedOverEstimated, 3)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <h3 className="fc-h3">Reference satellite and observation gaps</h3>
      <p className="fc-note">
        From 2022 each month uses one VIIRS satellite on the S-NPP scale (NOAA-20 × {fmt(cal.crossCalibration["NOAA-20"]?.k, 3)}, NOAA-21 × {fmt(cal.crossCalibration["NOAA-21"]?.k, 3)}; ratios over {cal.crossCalibration["NOAA-20"]?.months} and {cal.crossCalibration["NOAA-21"]?.months} months both observed completely). A satellite with an observation gap in the month is skipped. While S-NPP was in orbit, the reference switched in {switches.length} month{switches.length === 1 ? "" : "s"}: {switches.map((s, i) => <span key={s.month}>{i ? ", " : ""}<button type="button" className="text-button" onClick={() => onFocus(s.month)}>{monthLabel(s.month)}</button> ({s.reference})</span>)}.
      </p>
      <details className="fc-details" open>
        <summary>Observation gaps: {cal.coverage.events.filter((e) => e.status === "confirmed").length} confirmed by NASA/NOAA notices, {cal.coverage.events.filter((e) => e.status === "suspected").length} suspected (runs of 3+ days and all confirmed runs listed)</summary>
        <div className="fc-table-scroll">
          <table className="fc-table">
            <thead><tr><th scope="col">Satellite</th><th scope="col">Days</th><th scope="col" className="num">Gap / partial</th><th scope="col">Status</th><th scope="col">Evidence</th><th scope="col">Notice</th></tr></thead>
            <tbody>
              {cal.coverage.events.filter((e) => e.status === "confirmed" || e.gapDays + e.reducedDays >= 3).map((e) => (
                <tr key={e.platform + e.start}>
                  <td>{e.platform}</td><td>{e.start}{e.end !== e.start ? ` – ${e.end}` : ""}</td><td className="num">{e.gapDays} / {e.reducedDays}</td>
                  <td>{e.status}</td><td>{e.evidence.join(", ")}</td>
                  <td>{e.documented.map((id) => { const d = docs.get(id); return d ? <span key={id}>{d.title}{d.sources[0] && <> (<a href={d.sources[0]} target="_blank" rel="noreferrer">source</a>)</>}{d.verification ? ` · checked ${d.verification.checked}: ${d.verification.status}` : ""}</span> : id; })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {cal.coverageSensitivity && (
        <details className="fc-details">
          <summary>Sensitivity of the gap detection to its thresholds</summary>
          <div className="fc-table-scroll">
            <table className="fc-table">
              <thead><tr><th scope="col">Assumption</th><th scope="col" className="num">Flagged satellite-days</th><th scope="col" className="num">Runs</th><th scope="col" className="num">Confirmed runs</th><th scope="col" className="num">Notices recovered</th><th scope="col" className="num">Satellite-months with material loss</th></tr></thead>
              <tbody>{cal.coverageSensitivity.map((s) => <tr key={s.name}><td>{s.name}</td><td className="num">{s.flaggedDays}</td><td className="num">{s.runs}</td><td className="num">{s.confirmedRuns}</td><td className="num">{s.documentedRecovered} / {s.documented}</td><td className="num">{s.materialSatelliteMonths}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="fc-note">Every documented notice is recovered under every variant; the thresholds mainly change how many single suspected days are flagged. Detection only: the calibration is not refitted per variant.</p>
        </details>
      )}
      <div className="fc-actions">
        <button type="button" className="button small" onClick={() => download(`firelens_${region}_heldout_validation.csv`, csv(), "text/csv")}>Held-out validation CSV</button>
        <button type="button" className="button small" onClick={() => download(`firelens_${region}_validation.json`, json(), "application/json")}>Validation JSON</button>
      </div>
      <p className="fc-note">
        Limits: validated against MODIS (the target scale), not ground truth; held-out years come from one decade ({cal.trainingYearsWithData[0]}–{cal.trainingYearsWithData.at(-1)}); {Object.keys(cal.excludedMonths ?? {}).length} training months left out for incomplete coverage; clouds, smoke and observation opportunity are not modelled. Reproduce with <code>node scripts/harmonize/fit.mjs --region {region}</code>; calibration sha256 {calSha.slice(0, 16)}…
      </p>
    </section>
  );
}
