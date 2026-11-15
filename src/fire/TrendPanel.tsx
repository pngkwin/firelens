import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, ErrorBar, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthResult } from "../data/v2/series";
import { annualTotals, annualTrend, SCALES, type Scale } from "../data/v2/analysis";
import { fmt, VIRIDIS } from "./colors";

type Props = { months: MonthResult[]; scale: Scale; from: string; to: string };

export function TrendPanel({ months, scale, from, to }: Props) {
  const inRange = useMemo(() => months.filter((r) => r.month >= from && r.month <= to), [months, from, to]);
  const annual = useMemo(() => annualTotals(inRange, scale), [inRange, scale]);
  const trend = useMemo(() => annualTrend(annual, +from.slice(0, 4), +to.slice(0, 4)), [annual, from, to]);
  const data = annual.map((a) => ({
    year: a.year,
    complete: a.partial ? null : a.value,
    partial: a.partial ? a.value : null,
    err: a.hi !== a.lo ? [a.value - a.lo, a.hi - a.value] : [0, 0],
    fit: trend && !a.partial ? trend.intercept + trend.slope * a.year : null,
  }));
  const sig = trend ? (trend.p < 0.05 ? "statistically significant (p < 0.05)" : "not statistically significant") : "";
  return (
    <section className="fc-panel" aria-labelledby="fc-trend-title">
      <div className="fc-panel-head">
        <h2 id="fc-trend-title">Annual totals and trend</h2>
        <p className="fc-sub">{SCALES[scale].label}. Theil–Sen slope over complete years, Mann–Kendall test. Error bars: summed 90% bounds of estimated months (conservative).</p>
      </div>
      <p className="fc-verdict">
        {trend
          ? `Trend ${trend.slope >= 0 ? "+" : ""}${fmt(trend.slope)} ${SCALES[scale].unit} per year (95% CI ${fmt(trend.slopeLo)} to ${fmt(trend.slopeHi)}; ${trend.pctPerDecade == null ? "" : `${trend.pctPerDecade >= 0 ? "+" : ""}${fmt(trend.pctPerDecade)}% per decade; `}n = ${trend.n} years), ${sig}, p = ${fmt(trend.p, 3)}.`
          : "Not enough complete years in the selected range for a trend (needs 4)."}
      </p>
      <div className="fc-chart" role="img" aria-label={`Bar chart of annual ${SCALES[scale].short} ${SCALES[scale].unit}${trend ? ` with Theil–Sen trend line, slope ${fmt(trend.slope)} per year` : ""}`}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="#d9e2dc" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => fmt(v)} width={64} />
            <Tooltip formatter={(v) => fmt(Number(v))} />
            <Bar dataKey="complete" name="Complete year" fill={VIRIDIS[3]} isAnimationActive={false}>
              <ErrorBar dataKey="err" width={3} stroke="#203c34" />
            </Bar>
            <Bar dataKey="partial" name="Partial year" fill={VIRIDIS[7]} isAnimationActive={false} />
            <Line dataKey="fit" name="Theil–Sen trend" stroke="#b54c20" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="fc-note">Harmonized eras differ in source: estimated before 2002-07 (Terra-only) and from 2022 (VIIRS-based), observed MODIS in between. A trend across era boundaries partly depends on the calibration; compare with the raw-sensor scales.</p>
    </section>
  );
}
