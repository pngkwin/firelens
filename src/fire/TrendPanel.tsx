import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthResult } from "../data/v2/series";
import { annualTotals, annualTrend, SCALES, SCALE_PLATFORMS, type Scale } from "../data/v2/analysis";
import { fmt, VIRIDIS } from "./colors";

type Props = { months: MonthResult[]; scale: Scale; from: string; to: string };

export function TrendPanel({ months, scale, from, to }: Props) {
  const inRange = useMemo(() => months.filter((r) => r.month >= from && r.month <= to), [months, from, to]);
  const annual = useMemo(() => annualTotals(inRange, scale), [inRange, scale]);
  const tr = useMemo(() => annualTrend(annual, +from.slice(0, 4), +to.slice(0, 4), scale), [annual, from, to, scale]);
  const trend = tr.trend;
  const used = new Set(tr.years);
  const why = new Map(tr.excluded.map((e) => [e.year, e.reason]));
  const data = annual.map((a) => ({
    year: a.year,
    complete: used.has(a.year) ? a.value : null,
    other: used.has(a.year) ? null : a.value,
    err: a.hi !== a.lo ? [a.value - a.lo, a.hi - a.value] : [0, 0],
    fit: trend && used.has(a.year) ? trend.intercept + trend.slope * a.year : null,
  }));
  const unused = new Set(annual.filter((a) => !used.has(a.year)).map((a) => a.year));
  const sig = trend ? (trend.p < 0.05 ? "statistically significant (p < 0.05)" : "not statistically significant") : "";
  const raw = !!SCALE_PLATFORMS[scale];
  return (
    <section className="fc-panel" aria-labelledby="fc-trend-title">
      <div className="fc-panel-head">
        <h2 id="fc-trend-title">Annual totals and trend</h2>
        <p className="fc-sub">{SCALES[scale].label}. Theil–Sen slope over complete years, Mann–Kendall test. Error bars: summed 90% bounds of estimated months (conservative).</p>
      </div>
      <p className="fc-verdict">
        {trend
          ? `Trend ${trend.slope >= 0 ? "+" : ""}${fmt(trend.slope)} ${SCALES[scale].unit} per year (95% CI ${fmt(trend.slopeLo)} to ${fmt(trend.slopeHi)}; ${trend.pctPerDecade == null ? "" : `${trend.pctPerDecade >= 0 ? "+" : ""}${fmt(trend.pctPerDecade)}% per decade; `}n = ${trend.n} years), ${sig}, p = ${fmt(trend.p, 3)}.`
          : tr.note}
      </p>
      {trend && tr.note && <p className="fc-note">{tr.note}</p>}
      <div className="fc-chart" role="img" aria-label={`Bar chart of annual ${SCALES[scale].short} ${SCALES[scale].unit}${trend ? ` with Theil–Sen trend line, slope ${fmt(trend.slope)} per year` : ""}`}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }} accessibilityLayer={false}>
            <CartesianGrid stroke="#d9e2dc" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} tickFormatter={(y: number) => (unused.has(y) ? `${y}*` : String(y))} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => fmt(v)} width={64} />
            <Tooltip formatter={(v) => fmt(Number(v))} />
            <Bar dataKey="complete" name="Year used for the trend" fill={VIRIDIS[3]} isAnimationActive={false}>
              <ErrorBar dataKey="err" width={3} stroke="#203c34" />
            </Bar>
            <Bar dataKey="other" name="Not used (partial, outage or other satellites)" fill={VIRIDIS[7]} isAnimationActive={false} />
            <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="fit" name="Theil–Sen trend" stroke="#b54c20" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="fc-note">
        * not used for the trend: partial year{tr.excluded.length ? `, or ${tr.excluded.map((e) => `${e.year} (${e.reason})`).join("; ")}` : ""}.
      </p>
      <details className="fc-details">
        <summary>Annual totals (table)</summary>
        <div className="fc-table-scroll">
        <table className="fc-table">
          <caption>Annual totals</caption>
          <thead><tr><th scope="col">Year</th><th scope="col" className="num">{SCALES[scale].short} {SCALES[scale].unit}</th><th scope="col" className="num">90% bounds</th><th scope="col">Note</th></tr></thead>
          <tbody>
            {annual.map((a) => (
              <tr key={a.year}>
                <td>{a.year}</td>
                <td className="num">{fmt(a.value)}</td>
                <td className="num">{a.hi !== a.lo ? `${fmt(a.lo)}–${fmt(a.hi)}` : "–"}</td>
                <td>{[a.partial ? "partial year" : "", why.get(a.year) ?? "", a.reducedMonths ? `${a.reducedMonths} month${a.reducedMonths === 1 ? "" : "s"} with reduced satellite coverage` : ""].filter(Boolean).join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
      <p className="fc-note">
        {raw
          ? "Raw scales count what the satellites in orbit detected. Their totals rise when a satellite is added (S-NPP 2012, NOAA-20 2018, NOAA-21 2023) and fall when one stops (S-NPP 2026-11), so long-term change in fire activity is read from the harmonized scale."
          : "Harmonized eras differ in source: estimated before 2002-07 (Terra-only) and from 2022 (VIIRS-based), observed MODIS in between. A trend across era boundaries partly depends on the calibration (validated against held-out MODIS years, not against ground truth)."}
      </p>
    </section>
  );
}
