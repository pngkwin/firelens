import { useMemo } from "react";
import { briefHtml, briefMarkdown, buildBrief, type BriefInput } from "../data/v2/brief";
import { fmt, monthLabel } from "./colors";
import { download } from "./png";

type Props = { input: BriefInput | null; onFocus: (m: string) => void; onTab: (t: "season" | "atlas" | "transition" | "evidence" | "context") => void };
const pct = (v: number | null | undefined) => (v == null ? "n/a" :`${(100 * v).toFixed(0)}%`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Concise, evidence-backed historical monitoring brief for the selected area and period. */
export function RegionalBrief({ input, onFocus, onTab }: Props) {
  const br = useMemo(() => (input ? buildBrief(input) : null), [input]);
  if (!br) return <section className="fc-panel"><p className="fc-loading" role="status">Preparing the brief…</p></section>;
  const M = (m: string) => <button type="button" className="text-button" onClick={() => onFocus(m)}>{monthLabel(m)}</button>;
  const print = () => { document.body.classList.add("print-brief"); window.print(); setTimeout(() => document.body.classList.remove("print-brief"), 500); };
  return (
    <section className="fc-panel fc-brief" aria-labelledby="fc-brief-title">
      <div className="fc-panel-head">
        <h2 id="fc-brief-title">{br.title}</h2>
        <p className="fc-sub">{br.area.region} · {monthLabel(br.period.from)} – {monthLabel(br.period.to)} · data through {br.period.dataEnd} · harmonized MODIS-equivalent fire-cell-days. A historical monitoring summary: not burned area, not a count of individual fires, not a fire-risk forecast.</p>
      </div>
      <div className="fc-actions fc-noprint">
        <button type="button" className="button small" onClick={() => download(`firelens_brief_${slug(br.area.name)}_${br.period.from}_${br.period.to}.md`, briefMarkdown(br), "text/markdown")}>Download brief (Markdown)</button>
        <button type="button" className="button small" onClick={() => download(`firelens_brief_${slug(br.area.name)}_${br.period.from}_${br.period.to}.html`, briefHtml(br), "text/html")}>Download brief (HTML, print to PDF)</button>
        <button type="button" className="button small" onClick={print}>Print brief</button>
      </div>
      {br.planning && (
        <p className="fc-verdict"><strong>Planning context (historical pattern, not a forecast):</strong> in {br.planning.period} (observed MODIS), {pct(br.planning.share)} of a typical year's detected burning fell in {br.planning.busiest}, peaking in {br.planning.peak}; the quietest month was {br.planning.quiet}. Local fuels and weather decide actual fire danger.</p>
      )}
      {br.partialMonths.length > 0 && <p className="fc-note">Incomplete: {br.partialMonths.map((m) => `${monthLabel(m.month)} (data for ${m.days} of ${m.of} days)`).join("; ")}. Incomplete months are never treated as full months in baselines, anomalies, seasonal profiles or trends.</p>}
      <div className="fc-brief-grid">
        <div>
          <h3 className="fc-h3">Fire season evolution</h3>
          <ul className="fc-list">{br.seasonEvolution.profiles.map((s) => <li key={s.label}>{s.label} <span className="fc-dim">({s.note}, {s.n} yrs)</span>: peak {s.peak} ({pct(s.peakShare)}), busiest {s.busiest} ({pct(s.busiestShare)})</li>)}</ul>
          <p className="fc-note">{br.seasonEvolution.findings[1] ?? ""} <button type="button" className="text-button" onClick={() => onTab("season")}>Open the season view</button></p>
        </div>
        <div>
          <h3 className="fc-h3">Peak burning months</h3>
          <ol className="fc-list">{br.peaks.map((t) => <li key={t.key}>{M(t.key)}: {fmt(t.value)}{t.lo != null ? <span className="fc-dim"> (90% {fmt(t.lo)}–{fmt(t.hi)}, est.)</span> : <span className="fc-dim"> (observed)</span>}{t.reduced && <span className="fc-badge warn small">reduced coverage</span>}</li>)}</ol>
          {br.years.length > 0 && <p className="fc-note">Peak complete years: {br.years.map((y) => `${y.year} (${fmt(y.value)})`).join(", ")}.</p>}
        </div>
        <div>
          <h3 className="fc-h3">Seasonal pattern</h3>
          <p>Typical year (median by month): {br.season.map((s, i) => <span key={s.month}>{i ? "; " : ""}<strong>{s.month}</strong> {fmt(s.median)} ({pct(s.share)})</span>)} of the typical annual total.</p>
        </div>
        <div>
          <h3 className="fc-h3">Unusual months in the period</h3>
          {br.unusual.length ? (
            <ul className="fc-list">{br.unusual.map((u) => <li key={u.month}>{M(u.month)}: {fmt(u.value)}, {fmt(u.pctOfMedian)}% of median, percentile {fmt(u.percentile)}, {u.high ? "unusually high" : "unusually low"}{!u.intervalClear && <span className="fc-dim"> (90% interval overlaps the median)</span>}</li>)}</ul>
          ) : <p>No month in the period is in the top or bottom 10% of its comparable years.</p>}
          {br.focus && <p className="fc-note">Focus {monthLabel(br.focus.month)}: {br.focus.stats ? `${fmt(br.focus.value)}, ${fmt(br.focus.stats.pctOfMedian)}% of the median of ${br.focus.stats.n} comparable years (percentile ${fmt(br.focus.stats.percentile)}).` : br.focus.blocked}</p>}
        </div>
        <div>
          <h3 className="fc-h3">Largest past fire episodes</h3>
          {br.episodes ? (
            <ul className="fc-list">{br.episodes.largest.map((e) => <li key={e.start + e.centre.join()}>{M(e.peakDay.slice(0, 7))} {e.start} – {e.end}: {fmt(e.size)} cell-days, {e.days} days</li>)}</ul>
          ) : <p className="fc-note">Episodes are grouped inside a selected area (state, country, box or polygon); choose one to include them.</p>}
        </div>
        <div>
          <h3 className="fc-h3">Sensor disagreement and harmonization</h3>
          {br.atlas.shares ? <p>Of {fmt(br.atlas.total.union)} fire-cell-days seen by either sensor ({br.atlas.used} fully observed months), {pct(br.atlas.shares.viirsOnly)} were VIIRS-only, {pct(br.atlas.shares.both)} both, {pct(br.atlas.shares.modisOnly)} MODIS-only (night: {pct(br.atlas.night?.viirsOnly)} VIIRS-only). <button type="button" className="text-button" onClick={() => onTab("atlas")}>Open the atlas</button></p> : <p>No months observed completely by both sensors in this period.</p>}
          {br.trend.naive && br.trend.harmonized && <p>Trend {br.trend.years[0]}–{br.trend.years[1]}: naive sensor splice {fmt(br.trend.naive.pctPerDecade)}% per decade (p = {br.trend.naive.p.toPrecision(2)}, not comparable) vs harmonized {fmt(br.trend.harmonized.pctPerDecade)}% per decade (p = {br.trend.harmonized.p.toPrecision(2)}). <button type="button" className="text-button" onClick={() => onTab("transition")}>Why they differ</button></p>}
        </div>
        <div>
          <h3 className="fc-h3">Uncertainty and satellite coverage</h3>
          <p>{br.period.estimatedMonths} of {br.period.months} months are estimated with 90% intervals (region scale ×[{fmt(br.uncertainty.interval?.lo, 3)}, {fmt(br.uncertainty.interval?.hi, 3)}]){br.uncertainty.smallArea ? `; for this smaller area the sampling term is widened ×${fmt(br.uncertainty.aoiFactor, 2)} (validated on ~600,000 km² zones only)` : ""}. Validated against observed MODIS, not ground truth. <button type="button" className="text-button" onClick={() => onTab("evidence")}>See the evidence</button></p>
          <p>{br.reduced.length ? <>Reduced satellite coverage (lower bounds, excluded from anomalies and trends): {br.reduced.map((r, i) => <span key={r.month}>{i ? "; " : ""}{M(r.month)}</span>)}.</> : "No month in the period has reduced satellite coverage."}</p>
        </div>
      </div>
      {br.incidents.length > 0 && (
        <>
          <h3 className="fc-h3">Documented fires in this area (independent records)</h3>
          <ul className="fc-list">{br.incidents.map((i) => <li key={i.name}><strong>{i.name}</strong>: {i.place}; from {i.start}{i.end ? ` to ${i.end}` : ""}{i.size ? `; ${i.size}` : ""}. <span className="fc-dim">{i.source.map((s) => s.publisher).join("; ")}</span></li>)}</ul>
          <p className="fc-note">Agency acreage is burned area; it is not comparable with fire-cell-days. <button type="button" className="text-button" onClick={() => onTab("context")}>Compare with the satellite record</button></p>
        </>
      )}
      <p className="fc-note">Scope: FireLens holds the complete record from November 2000 for its two supported regions (United States and Iberian Peninsula); it is not a global database.</p>
      <h3 className="fc-h3">Sources and provenance</h3>
      <ul className="fc-list fc-dim">
        <li>NASA FIRMS MODIS C6.1 (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20, NOAA-21); science-quality archive, near-real-time after.</li>
        <li>Area {br.area.aoi || "whole region"}; boundary: {br.area.boundary}; {br.area.cellRule}.</li>
        <li>Method {br.provenance.method} ({br.provenance.selected}); coverage audit {br.provenance.coverageVersion}; calibration sha256 {br.provenance.calibrationSha256.slice(0, 16)}…; bundle manifest sha256 {br.provenance.manifestSha256.slice(0, 16)}…; {br.provenance.filesUsed} verified files.</li>
      </ul>
    </section>
  );
}
