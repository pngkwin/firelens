import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthResult } from "../data/v2/series";
import { readings, readingVerdict, SPLICE_YEAR, transitionSeries, trendReadings } from "../data/v2/transition";
import { fmt, MONTH_ABBR, monthLabel } from "./colors";

type Props = { months: MonthResult[]; focus: string | null; from: string; to: string; onFocus: (m: string) => void };

const trendText = (t: { pctPerDecade: number | null; p: number; n: number } | null) =>
  !t ? "no trend (fewer than 4 complete years)" : `${t.pctPerDecade == null ? "" : `${t.pctPerDecade >= 0 ? "+" : ""}${fmt(t.pctPerDecade)}% per decade, `}${t.p < 0.05 ? "significant" : "not significant"} (p = ${t.p < 0.001 ? t.p.toExponential(1) : fmt(t.p, 3)}, n = ${t.n})`;

/** How a naive sensor switch changes the reading of a month and of the long-term trend. */
export function TransitionPanel({ months, focus, from, to, onFocus }: Props) {
  const moy = (focus ?? to).slice(5, 7);
  const rows = useMemo(() => transitionSeries(months, moy), [months, moy]);
  const read = useMemo(() => (focus ? readings(months, focus) : null), [months, focus]);
  const y0 = Math.max(2003, +from.slice(0, 4)), y1 = Math.min(+to.slice(0, 4), 2025);
  const tr = useMemo(() => trendReadings(months, y0, y1), [months, y0, y1]);
  const data = rows.map((r) => ({ ...r, band: r.lo != null && r.hi != null ? [r.lo, r.hi] : null }));
  const changed = read && readingVerdict(read[0]) !== readingVerdict(read[2]);
  const trendFlip = tr.naive && tr.harmonized && (Math.sign(tr.naive.slope) !== Math.sign(tr.harmonized.slope) || (tr.naive.p < 0.05) !== (tr.harmonized.p < 0.05));
  return (
    <section className="fc-panel" aria-labelledby="fc-transition-title">
      <div className="fc-panel-head">
        <h2 id="fc-transition-title">Why harmonization matters: the sensor transition</h2>
        <p className="fc-sub">
          VIIRS replaced MODIS as the main fire sensor. A record that simply switches sensors in {SPLICE_YEAR} (raw MODIS before, raw VIIRS after) is <strong>not comparable across the switch</strong>: VIIRS detects about twice as many fire-cell-days. The naive splice is shown deliberately, as an example of an <strong>invalid method that must not be used to infer trends</strong>; it exists only to expose the artefact. Below, the same area and month under three readings.
        </p>
      </div>
      <h3 className="fc-h3">Long-term trend, complete years {tr.years[0]}–{tr.years[1]}</h3>
      <div className="fc-two-inner">
        <div className="fc-stat fc-noncomparable"><span className="fc-stat-label">Naive sensor splice (not comparable; invalid for trend inference)</span><strong>{trendText(tr.naive)}</strong></div>
        <div className="fc-stat"><span className="fc-stat-label">Harmonized MODIS-equivalent</span><strong>{trendText(tr.harmonized)}</strong><span className="fc-stat-note">outage years left out; see the trend panel</span></div>
      </div>
      <p className="fc-verdict">
        {!tr.naive || !tr.harmonized
          ? "Not enough complete years for both trends in this range."
          : trendFlip
            ? `The interpretation changes: the naive splice says ${trendText(tr.naive)}, the harmonized record says ${trendText(tr.harmonized)}. The naive increase comes from switching to the more sensitive sensor, not from more fire.`
            : "Both readings agree in direction and significance here; the naive splice still overstates the size of any change."}
      </p>
      <h3 className="fc-h3">{MONTH_ABBR[+moy - 1]} in every year{focus ? `, focus ${monthLabel(focus)}` : ""}</h3>
      <div className="fc-chart" role="img" aria-label={`${MONTH_ABBR[+moy - 1]} fire-cell-days per year: harmonized with 90% interval, raw MODIS, raw VIIRS and the naive splice; values in the table below`}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} accessibilityLayer={false}>
            <CartesianGrid stroke="#d9e2dc" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v)} width={56} />
            <Tooltip formatter={(v) => (Array.isArray(v) ? `${fmt(Number(v[0]))}–${fmt(Number(v[1]))}` : fmt(Number(v)))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine x={SPLICE_YEAR} stroke="#b54c20" strokeDasharray="4 3" label={{ value: "sensor switch", fontSize: 11, fill: "#7a2a10", position: "insideTopLeft" }} />
            <Area dataKey="band" name="Harmonized 90% interval" stroke="none" fill="#9fb8ad" fillOpacity={0.45} isAnimationActive={false} connectNulls />
            <Line dataKey="naive" name="Naive splice (invalid: not comparable)" stroke="#b54c20" strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
            <Line dataKey="rawViirs" name="Raw VIIRS" stroke="#2a6f97" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="rawModis" name="Raw MODIS" stroke="#c9822b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="harmonized" name="Harmonized MODIS-equivalent" stroke="#173e36" strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {read ? (
        <>
          <div className="fc-table-scroll">
            <table className="fc-table">
              <caption>{monthLabel(focus!)} against the same month in other years</caption>
              <thead><tr><th scope="col">Reading</th><th scope="col" className="num">Value</th><th scope="col" className="num">% of median</th><th scope="col" className="num">Percentile</th><th scope="col">Verdict</th><th scope="col">Note</th></tr></thead>
              <tbody>
                {read.map((r) => (
                  <tr key={r.label} className={r.comparable ? "" : "fc-noncomparable"}>
                    <td>{r.label}{!r.comparable && <span className="fc-badge warn small">not comparable</span>}</td>
                    <td className="num">{fmt(r.value)}</td>
                    <td className="num">{r.stats?.pctOfMedian == null ? "–" : `${fmt(r.stats.pctOfMedian)}%`}</td>
                    <td className="num">{fmt(r.stats?.percentile)}</td>
                    <td>{readingVerdict(r)}</td>
                    <td className="fc-dim">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fc-verdict">{changed ? `For ${monthLabel(focus!)} the naive splice reads “${readingVerdict(read[0])}” but the harmonized record reads “${readingVerdict(read[2])}”.` : `For ${monthLabel(focus!)} the naive splice and the harmonized record give the same verdict (${readingVerdict(read[2])}); the values still differ.`}</p>
        </>
      ) : (
        <p className="fc-note">Select a complete month in the calendar to compare its three readings.</p>
      )}
      <details className="fc-details">
        <summary>{MONTH_ABBR[+moy - 1]} per year (table)</summary>
        <div className="fc-table-scroll">
          <table className="fc-table">
            <thead><tr><th scope="col">Year</th><th scope="col" className="num">Harmonized</th><th scope="col" className="num">90% interval</th><th scope="col" className="num">Raw MODIS</th><th scope="col" className="num">Raw VIIRS</th><th scope="col" className="num">Naive splice</th><th scope="col">Note</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.year}><td>{r.year}</td><td className="num">{fmt(r.harmonized)}</td><td className="num">{r.lo == null ? "observed" : `${fmt(r.lo)}–${fmt(r.hi)}`}</td><td className="num">{fmt(r.rawModis)}</td><td className="num">{r.rawViirs == null ? "not in orbit" : fmt(r.rawViirs)}</td><td className="num">{fmt(r.naive)}</td><td>{[r.estimated ? "estimated" : "", r.reduced ? "reduced coverage" : "", r.partial ? "partial month" : ""].filter(Boolean).join(", ")}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className="fc-note">MODIS alone avoids the sensor switch but not the MODIS orbit drift from 2022 (recent MODIS counts run below the stable-orbit expectation) or outages. The harmonized series uses observed MODIS for 2002-07 – 2021 and VIIRS cross-calibrated to MODIS from 2022, with intervals validated on held-out years (see the Evidence lab).</p>
    </section>
  );
}
