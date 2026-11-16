import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthResult } from "../data/v2/series";
import { analyzeSeason, MONTH_NAMES, monthPosition } from "../data/v2/season";
import { fmt } from "./colors";
import { download } from "./png";

type Props = { months: MonthResult[]; areaName: string; isSubArea: boolean };
const COLORS = ["#31688e", "#b54c20", "#5f7069"];
const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** How the distribution of detected burning across the months of the year differs between periods. */
export function SeasonPanel({ months, areaName, isSubArea }: Props) {
  const s = useMemo(() => analyzeSeason(months), [months]);
  const [p1, p2] = s.profiles;
  const chart = MONTH_NAMES.map((name, i) => Object.fromEntries([["name", name], ...s.profiles.map((p) => [p.period.id, +(100 * p.shares[i]).toFixed(2)])]));
  const sensorChart = s.sensor ? MONTH_NAMES.map((name, i) => ({ name, modis: +(100 * s.sensor!.modis[i]).toFixed(2), snpp: +(100 * s.sensor!.snpp[i]).toFixed(2) })) : [];
  const csv = () => {
    const L = ["# FireLens fire-season profiles: mean share of each year's harmonized MODIS-equivalent fire-cell-days in each month (years normalized to their own annual total; equal weight per year).", `# Area: ${areaName}. Descriptive; state-scale and smaller intervals are not validated.`, ["period", "basis", "years_used", ...MONTH_NAMES.map((m) => `share_${m.toLowerCase()}`), "peak_month", "seasonal_centre_month", "concentration_r", "months_for_80pct"].join(",")];
    for (const p of s.profiles) L.push([p.period.label, p.period.note.replaceAll(",", ";"), p.years.join(" "), ...p.shares.map((v) => v.toFixed(5)), MONTH_NAMES[p.peakMonth], p.centroid.toFixed(3), p.r.toFixed(4), p.m80].join(","));
    if (s.tests) { L.push("", "statistic,period_a,period_b,difference,p_permutation,p_holm,permutations,exact"); for (const t of s.tests) L.push([t.stat.label.replaceAll(",", ";"), t.a.toFixed(4), t.b.toFixed(4), t.diff.toFixed(4), t.p.toFixed(4), t.pHolm.toFixed(4), t.permutations, t.exact].join(",")); }
    download(`firelens_fire_season_${slug(areaName)}.csv`, L.join("\n") + "\n", "text/csv");
  };
  return (
    <section className="fc-panel" aria-labelledby="fc-season-title">
      <div className="fc-panel-head">
        <h2 id="fc-season-title">Fire season evolution: {areaName}</h2>
        <p className="fc-sub">How detected burning is distributed across the months of the year, and whether that distribution differs between periods. Each year is first normalized to its own annual total, so a single extreme year does not set the profile. Harmonized MODIS-equivalent fire-cell-days; complete years only; years whose satellite outages may hide more than 2% of the total are left out.</p>
      </div>
      {!p1 || !p2 ? <p className="fc-note">Not enough complete years in this area for a seasonal comparison.</p> : (
        <>
          <ul className="fc-list fc-findings">{s.findings.map((f) => <li key={f}>{f}</li>)}</ul>
          <div className="fc-focus-grid">
            {s.profiles.map((p, i) => (
              <div className="fc-stat" key={p.period.id}>
                <span className="fc-stat-label" style={{ color: COLORS[i] }}>{p.period.label} · {p.period.note}</span>
                <strong>Peak {MONTH_NAMES[p.peakMonth]} ({pct(p.peakShare, 0)})</strong>
                <span className="fc-stat-note">busiest 3 months {MONTH_NAMES[p.peak3.start]}–{MONTH_NAMES[(p.peak3.start + 2) % 12]} {pct(p.peak3.share, 0)}; {p.n} years; profile centre {monthPosition(p.centroid)}</span>
              </div>
            ))}
          </div>
          <div className="fc-chart" role="img" aria-label={`Line chart: mean monthly share of annual fire-cell-days for ${s.profiles.map((p) => p.period.label).join(", ")}; values in the table below`}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} accessibilityLayer={false}>
                <CartesianGrid stroke="#d9e2dc" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" width={48} />
                <Tooltip formatter={(v) => `${fmt(Number(v), 1)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {s.profiles.map((p, i) => <Line key={p.period.id} dataKey={p.period.id} name={`${p.period.label} (${p.period.note})`} stroke={COLORS[i]} strokeWidth={2} strokeDasharray={i === 2 ? "5 3" : undefined} dot={{ r: 2 }} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="fc-table-scroll">
            <table className="fc-table">
              <caption>Seasonal profile by period (mean share of the annual total)</caption>
              <thead><tr><th scope="col">Period</th>{MONTH_NAMES.map((m) => <th key={m} scope="col" className="num">{m}</th>)}<th scope="col" className="num">Months for 80% (profile)</th><th scope="col" className="num">Concentration R (profile)</th></tr></thead>
              <tbody>{s.profiles.map((p) => <tr key={p.period.id}><td>{p.period.label}<span className="fc-dim"> ({p.n} yrs)</span></td>{p.shares.map((v, i) => <td key={i} className={`num${i === p.peakMonth ? " fc-selected" : ""}`}>{(100 * v).toFixed(1)}</td>)}<td className="num">{p.m80}</td><td className="num">{p.r.toFixed(2)}</td></tr>)}</tbody>
            </table>
          </div>
          {s.tests && (
            <div className="fc-table-scroll">
              <table className="fc-table">
                <caption>Change from {p1.period.label} to {p2.period.label}: year-level permutation tests ({s.tests[0].exact ? `all ${fmt(s.tests[0].permutations)} splits` : `${fmt(s.tests[0].permutations)} random splits`}), Holm-corrected</caption>
                <thead><tr><th scope="col">Statistic</th><th scope="col" className="num">{p1.period.label}</th><th scope="col" className="num">{p2.period.label}</th><th scope="col" className="num">Change</th><th scope="col" className="num">p</th><th scope="col" className="num">Holm p</th></tr></thead>
                <tbody>{s.tests.map((t) => <tr key={t.stat.id}><td>{t.stat.label}</td><td className="num">{t.stat.id === "centroid" ? monthPosition(t.a) : t.a.toFixed(2)}</td><td className="num">{t.stat.id === "centroid" ? monthPosition(t.b) : t.b.toFixed(2)}</td><td className="num">{Math.abs(t.diff) < 0.005 ? "" : t.diff > 0 ? "+" : ""}{(Math.abs(t.diff) < 0.005 ? 0 : t.diff).toFixed(2)}{t.stat.unit ? ` ${t.stat.unit}` : ""}</td><td className="num">{t.p.toFixed(3)}</td><td className={`num${t.pHolm < 0.05 ? " fc-selected" : ""}`}>{t.pHolm.toFixed(3)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {s.sensor && (
            <details className="fc-details">
              <summary>Does the measurement system change the seasonal picture? (raw MODIS vs raw S-NPP VIIRS, {s.sensor.years[0]}–{s.sensor.years.at(-1)})</summary>
              <p className="fc-note">Same years ({s.sensor.years.join(", ")}), only months both sensors observed completely. VIIRS detects more small and cool fires, so where its seasonal shape differs from MODIS the harmonized (MODIS-equivalent) profile reflects what MODIS would see, not every fire VIIRS sees.</p>
              <div className="fc-chart" role="img" aria-label="Line chart comparing the seasonal share profile of raw MODIS and raw S-NPP VIIRS over the same years">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={sensorChart} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} accessibilityLayer={false}>
                    <CartesianGrid stroke="#d9e2dc" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} unit="%" width={48} />
                    <Tooltip formatter={(v) => `${fmt(Number(v), 1)}%`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line dataKey="modis" name="Raw MODIS (Terra ∪ Aqua)" stroke="#b54c20" strokeWidth={2} isAnimationActive={false} />
                    <Line dataKey="snpp" name="Raw S-NPP VIIRS" stroke="#2a6f97" strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </details>
          )}
          <div className="fc-actions"><button type="button" className="button small" onClick={csv}>Season profiles and tests (CSV)</button></div>
          <details className="fc-details">
            <summary>Method and limits</summary>
            <ul className="fc-list">
              <li>The first two periods are both <strong>observed MODIS</strong>, so their comparison does not depend on the calibration. 2022–2025 values are <strong>estimated from VIIRS</strong> with month-of-year ratios, which partly shape that profile; it is shown, not tested.</li>
              <li>Permutation tests treat years as exchangeable between periods (no model of drought cycles or year-to-year dependence) and are corrected for testing three statistics. A non-significant result is not proof of no change: with about 7–10 years per period only large shifts are detectable.</li>
              <li>{isSubArea ? "This is a sub-area (state, drawn shape or box). Model intervals at this scale are not validated, so these are descriptive findings about the detection record." : "Whole-region statistics."} Fire-cell-days are satellite detections, not burned area or numbers of fires; this is not a forecast of future fire seasons.</li>
              {s.excluded.filter((e) => e.reason !== "incomplete year").length > 0 && <li>Years left out for satellite outages: {s.excluded.filter((e) => e.reason !== "incomplete year").map((e) => `${e.year} (${e.reason})`).join("; ")}.</li>}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
