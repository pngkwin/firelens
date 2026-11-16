import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthResult } from "../data/v2/series";
import { atlasSummary, confirmedBy, shares, type Split } from "../data/v2/disagreement";
import { fmt, MONTH_ABBR, monthLabel } from "./colors";

export type MapLayer = "activity" | "viirs-only" | "modis-only" | "both";
type Props = { months: MonthResult[]; from: string; to: string; focus: string | null; mapLayer: MapLayer; onMapLayer: (l: MapLayer) => void; onFocus: (m: string) => void };

const COLORS = { modisOnly: "#b54c20", both: "#5f7069", viirsOnly: "#2a6f97" };
const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "n/a" : `${(100 * x).toFixed(d)}%`);
const row = (label: string, s: Split) => { const sh = shares(s); return { label, ...s, sh }; };

/** MODIS-only / VIIRS-only / both fire-cell-days for the selected area and period. */
export function DisagreementAtlas({ months, from, to, focus, mapLayer, onMapLayer, onFocus }: Props) {
  const a = useMemo(() => atlasSummary(months, from < "2012-01" ? "2012-01" : from, to), [months, from, to]);
  const tot = shares(a.total), conf = confirmedBy(a.total);
  const focusSplit = focus ? a.months.find((m) => m.month === focus) : undefined;
  const yearly = a.byYear.map((y) => ({ year: y.year, ...y.any, months: y.months }));
  const seasonal = a.byMoy.map((m) => ({ name: MONTH_ABBR[m.moy - 1], day: shares(m.day)?.viirsOnly ?? null, night: shares(m.night)?.viirsOnly ?? null, months: m.months }));
  const rows = [row("All overpasses", a.total), row("Day", a.day), row("Night", a.night)];
  return (
    <section className="fc-panel" aria-labelledby="fc-atlas-title">
      <div className="fc-panel-head">
        <h2 id="fc-atlas-title">Sensor disagreement atlas</h2>
        <p className="fc-sub">
          Fire-cell-days in this area detected by MODIS only, by VIIRS only, or by both, {monthLabel(a.months[0]?.month ?? from)} – {monthLabel(to)}. The three categories are exact and exclusive: they add up to the cell-days detected by either sensor (the union). Only months both sensors observed completely are counted ({a.used} of {a.months.length}).
        </p>
      </div>
      {!tot ? (
        <p className="fc-note">No months in this range were observed completely by both MODIS and VIIRS (VIIRS starts 2012-01-20).</p>
      ) : (
        <>
          <div className="fc-focus-grid">
            <div className="fc-stat big"><span className="fc-stat-label">Union: detected by either sensor</span><strong>{fmt(a.total.union)}</strong><span className="fc-stat-note">fire-cell-days, {a.used} months</span></div>
            <div className="fc-stat"><span className="fc-stat-label" style={{ color: COLORS.viirsOnly }}>VIIRS only</span><strong>{pct(tot.viirsOnly)}</strong><span className="fc-stat-note">{fmt(a.total.viirsOnly)} of the union</span></div>
            <div className="fc-stat"><span className="fc-stat-label">Both sensors</span><strong>{pct(tot.both)}</strong><span className="fc-stat-note">{fmt(a.total.both)} of the union</span></div>
            <div className="fc-stat"><span className="fc-stat-label" style={{ color: COLORS.modisOnly }}>MODIS only</span><strong>{pct(tot.modisOnly)}</strong><span className="fc-stat-note">{fmt(a.total.modisOnly)} of the union</span></div>
            <div className="fc-stat"><span className="fc-stat-label">MODIS cell-days also seen by VIIRS</span><strong>{pct(conf.modisSeenByViirs)}</strong><span className="fc-stat-note">denominator: MODIS cell-days</span></div>
            <div className="fc-stat"><span className="fc-stat-label">VIIRS cell-days also seen by MODIS</span><strong>{pct(conf.viirsSeenByModis)}</strong><span className="fc-stat-note">denominator: VIIRS cell-days</span></div>
          </div>
          {focusSplit && (
            <p className="fc-verdict">
              {monthLabel(focusSplit.month)}: {focusSplit.issue ? `left out of the statistics (${focusSplit.issue}).` : focusSplit.any.union === 0 ? "no matching records from either sensor." : `VIIRS only ${pct(shares(focusSplit.any)?.viirsOnly)}, both ${pct(shares(focusSplit.any)?.both)}, MODIS only ${pct(shares(focusSplit.any)?.modisOnly)} of ${fmt(focusSplit.any.union)} cell-days.`}
            </p>
          )}
          <div className="fc-atlas-map" role="group" aria-label="Map layer">
            <span>Map colours:</span>
            {(["activity", "viirs-only", "both", "modis-only"] as const).map((l) => (
              <button key={l} type="button" className={`button small${mapLayer === l ? " active" : ""}`} aria-pressed={mapLayer === l} onClick={() => onMapLayer(l)}>
                {l === "activity" ? "Fire activity" : l === "viirs-only" ? "VIIRS-only share" : l === "both" ? "Both-sensor share" : "MODIS-only share"}
              </button>
            ))}
            <span className="fc-dim">Map shares use H3 res-3 cells (~12,000 km²) with at least 20 cell-days. <strong>Annual resolution:</strong> each cell sums whole calendar years {Math.max(2012, +from.slice(0, 4))}–{to.slice(0, 4)}, so outage months cannot be removed on the map; the tables and charts here are monthly and leave them out.</span>
          </div>
          <div className="fc-two-inner">
            <figure className="fc-figure">
              <figcaption>Cell-days per year by category (stacked = union)</figcaption>
              <div className="fc-chart" role="img" aria-label="Stacked bars of MODIS-only, both and VIIRS-only fire-cell-days per year; values in the table below">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={yearly} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} accessibilityLayer={false}>
                    <CartesianGrid stroke="#d9e2dc" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v)} width={56} />
                    <Tooltip formatter={(v) => fmt(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="modisOnly" name="MODIS only" stackId="s" fill={COLORS.modisOnly} isAnimationActive={false} />
                    <Bar dataKey="both" name="Both" stackId="s" fill={COLORS.both} isAnimationActive={false} />
                    <Bar dataKey="viirsOnly" name="VIIRS only" stackId="s" fill={COLORS.viirsOnly} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </figure>
            <figure className="fc-figure">
              <figcaption>Season: VIIRS-only share of the union, day vs night</figcaption>
              <div className="fc-chart" role="img" aria-label="VIIRS-only share by month of year for day and night overpasses; values in the table below">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={seasonal} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} accessibilityLayer={false}>
                    <CartesianGrid stroke="#d9e2dc" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} />
                    <Tooltip formatter={(v) => pct(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line dataKey="day" name="Day" stroke="#c9822b" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                    <Line dataKey="night" name="Night" stroke="#173e36" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </figure>
          </div>
          <div className="fc-table-scroll">
            <table className="fc-table">
              <caption>Overpass breakdown (denominator: union of the overpass)</caption>
              <thead><tr><th scope="col">Overpass</th><th scope="col" className="num">Union</th><th scope="col" className="num">MODIS only</th><th scope="col" className="num">Both</th><th scope="col" className="num">VIIRS only</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{fmt(r.union)}</td><td className="num">{fmt(r.modisOnly)} ({pct(r.sh?.modisOnly)})</td><td className="num">{fmt(r.both)} ({pct(r.sh?.both)})</td><td className="num">{fmt(r.viirsOnly)} ({pct(r.sh?.viirsOnly)})</td></tr>)}</tbody>
            </table>
          </div>
          <details className="fc-details">
            <summary>Per year and per month of year (tables)</summary>
            <div className="fc-table-scroll">
              <table className="fc-table">
                <caption>Per year</caption>
                <thead><tr><th scope="col">Year</th><th scope="col" className="num">Months</th><th scope="col" className="num">Union</th><th scope="col" className="num">MODIS only</th><th scope="col" className="num">Both</th><th scope="col" className="num">VIIRS only</th></tr></thead>
                <tbody>{a.byYear.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{y.months}</td><td className="num">{fmt(y.any.union)}</td><td className="num">{pct(shares(y.any)?.modisOnly)}</td><td className="num">{pct(shares(y.any)?.both)}</td><td className="num">{pct(shares(y.any)?.viirsOnly)}</td></tr>)}</tbody>
              </table>
              <table className="fc-table">
                <caption>Per month of year (VIIRS-only share)</caption>
                <thead><tr><th scope="col">Month</th><th scope="col" className="num">Months</th><th scope="col" className="num">Day</th><th scope="col" className="num">Night</th><th scope="col" className="num">All</th></tr></thead>
                <tbody>{a.byMoy.map((m) => <tr key={m.moy}><td>{MONTH_ABBR[m.moy - 1]}</td><td className="num">{m.months}</td><td className="num">{pct(shares(m.day)?.viirsOnly)}</td><td className="num">{pct(shares(m.night)?.viirsOnly)}</td><td className="num">{pct(shares(m.any)?.viirsOnly)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
          {a.excluded.length > 0 && (
            <details className="fc-details">
              <summary>Coverage: {a.excluded.length} month{a.excluded.length === 1 ? "" : "s"} left out (satellite started, stopped or had an outage)</summary>
              <ul className="fc-list">{a.excluded.map((e) => <li key={e.month}><button type="button" className="text-button" onClick={() => onFocus(e.month)}>{monthLabel(e.month)}</button>: {e.issue}</li>)}</ul>
            </details>
          )}
          <p className="fc-note">
            Disagreement does not mean either sensor is wrong. VIIRS has 375 m pixels and detects smaller and cooler fires, which is why most of the union is VIIRS-only and why the share rises at night and outside the main fire season. Terra observes about three hours before the afternoon satellites, so a fire can burn out between overpasses; clouds and smoke can hide a fire from one overpass only. A day on which one satellite was not observing (outage) inflates the other sensor’s “only” category, so such months are left out. Raw counts change when satellites are added or lost; the harmonized scale corrects for that.
          </p>
        </>
      )}
    </section>
  );
}
