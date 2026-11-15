import { useMemo } from "react";
import type { MonthResult } from "../data/v2/series";
import { annualTotals, climatology, rankMonths, SCALES, type Scale } from "../data/v2/analysis";
import { fmt, MONTH_ABBR, monthLabel } from "./colors";

type Props = { months: MonthResult[]; scale: Scale; from: string; to: string; onFocus: (m: string) => void };

export function Rankings({ months, scale, from, to, onFocus }: Props) {
  const inRange = useMemo(() => months.filter((r) => r.month >= from && r.month <= to), [months, from, to]);
  const topMonths = useMemo(() => rankMonths(inRange, scale, 10), [inRange, scale]);
  const topYears = useMemo(() => annualTotals(inRange, scale).filter((a) => !a.partial).sort((a, b) => b.value - a.value).slice(0, 10), [inRange, scale]);
  const clim = useMemo(() => climatology(inRange, scale), [inRange, scale]);
  const peak = Math.max(1, ...clim.map((c) => c.median ?? 0));
  return (
    <section className="fc-panel" aria-labelledby="fc-rank-title">
      <div className="fc-panel-head">
        <h2 id="fc-rank-title">Most fire</h2>
        <p className="fc-sub">{SCALES[scale].label}, {monthLabel(from)} – {monthLabel(to)}. Values marked “est.” are model estimates with 90% intervals.</p>
      </div>
      <div className="fc-rank-grid">
        <table className="fc-table">
          <caption>Top months</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Month</th><th scope="col">{SCALES[scale].unit === "hotspots" ? "Hotspots" : "Fire-cell-days"}</th><th scope="col">90% interval</th></tr></thead>
          <tbody>
            {topMonths.map((t, i) => (
              <tr key={t.key}>
                <td>{i + 1}</td>
                <td><button type="button" className="text-button" onClick={() => onFocus(t.key)}>{monthLabel(t.key)}</button>{t.estimated && <span className="fc-badge est small">est.</span>}{t.partial && <span className="fc-badge small">partial</span>}</td>
                <td className="num">{fmt(t.value)}</td>
                <td className="num">{t.lo == null ? "observed" : `${fmt(t.lo)}–${fmt(t.hi)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="fc-table">
          <caption>Top complete years</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Year</th><th scope="col">{SCALES[scale].unit === "hotspots" ? "Hotspots" : "Fire-cell-days"}</th><th scope="col">Estimated months</th></tr></thead>
          <tbody>
            {topYears.map((a, i) => (
              <tr key={a.year}>
                <td>{i + 1}</td>
                <td>{a.year}</td>
                <td className="num">{fmt(a.value)}{a.hi !== a.lo && <span className="fc-dim"> ({fmt(a.lo)}–{fmt(a.hi)})</span>}</td>
                <td className="num">{a.estimatedMonths}/12</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="fc-table">
          <caption>Typical year (median by month)</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">Median</th><th scope="col" aria-label="Relative bar" /><th scope="col">Max</th></tr></thead>
          <tbody>
            {clim.map((c) => (
              <tr key={c.moy}>
                <td>{MONTH_ABBR[c.moy - 1]}</td>
                <td className="num">{fmt(c.median)}</td>
                <td className="fc-bar-cell" aria-hidden="true"><span className="fc-bar" style={{ width: `${(100 * (c.median ?? 0)) / peak}%` }} /></td>
                <td className="num">{fmt(c.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fc-note">Year ranks: differences under about 7% (US) or 25% (Iberia) between estimated years are within the validated error and should not be read as a ranking.</p>
    </section>
  );
}
