import { useMemo } from "react";
import type { DayResult } from "../data/v2/series";
import { SCALES, type Scale } from "../data/v2/analysis";
import { doyIndex, doyLabel, historicalOutlook, inPeriod, recentWindow, type DayCheck, type Period, type WindowComparison } from "../data/v2/earlyWarning";
import { diverging, fmt, textOn } from "./colors";

type Props = { days: DayResult[] | null; scale: Scale; obs?: DayCheck; coverStart: string; dataEnd: string; periods: Period[]; climYears: number; provisionalFrom: string | null };

function WindowTile({ w, unit, title }: { w: WindowComparison; unit: string; title: string }) {
  const s = w.stats, fill = diverging(s?.pctOfMedian ?? null);
  return (
    <div className="fc-stat fc-ew-tile">
      <span className="fc-stat-label">{title} ({w.start.slice(5)} – {w.end.slice(5)})</span>
      <strong>{fmt(w.value)}</strong>
      <span className="fc-stat-note">{unit}</span>
      {s ? (
        <>
          <span className="fc-ew-chip" style={{ background: fill, color: textOn(fill) }}>{s.pctOfMedian == null ? "median 0" : `${fmt(s.pctOfMedian)}% of median`}</span>
          <span className="fc-stat-note">{s.pctOfMean == null ? "" : `${fmt(s.pctOfMean)}% of ${s.n}-year average · `}rank {s.rank} of {s.of}{s.z == null ? "" : ` · z ${s.z >= 0 ? "+" : ""}${fmt(s.z, 1)}`}</span>
        </>
      ) : <span className="fc-stat-note">{w.blocked ?? "No earlier years cover this window."}</span>}
    </div>
  );
}

export function EarlyWarning({ days, scale, obs, coverStart, dataEnd, periods, climYears, provisionalFrom }: Props) {
  const unit = SCALES[scale].unit;
  const w7 = useMemo(() => (days ? recentWindow(days, dataEnd, 7, scale, coverStart, obs) : null), [days, dataEnd, scale, coverStart, obs]);
  const w30 = useMemo(() => (days ? recentWindow(days, dataEnd, 30, scale, coverStart, obs) : null), [days, dataEnd, scale, coverStart, obs]);
  const outlook = useMemo(() => (days ? historicalOutlook(days, dataEnd, 28, scale, coverStart, dataEnd, obs) : null), [days, dataEnd, scale, coverStart, obs]);
  const today = doyIndex(dataEnd);
  const current = periods.find((p) => inPeriod(p, today));
  const upcoming = periods.find((p) => !inPeriod(p, today) && Array.from({ length: 28 }, (_, k) => (today + 1 + k) % 365).some((i) => inPeriod(p, i)));
  const flag = !w7?.stats ? null : w7.stats.percentile >= 90 || w30?.stats && w30.stats.percentile >= 90 ? "high" : w7.stats.percentile >= 75 ? "elevated" : null;
  return (
    <section className="fc-panel fc-ew" aria-labelledby="fc-ew-title">
      <div className="fc-panel-head">
        <h2 id="fc-ew-title">Early warning: recent activity and critical periods</h2>
        <p className="fc-sub">{SCALES[scale].label}. Recent windows end on {dataEnd}{provisionalFrom && dataEnd >= provisionalFrom ? " (latest days provisional)" : ""} and are compared with the same calendar days in every earlier year that the satellites observed in full (raw scales: by the same satellites).</p>
      </div>
      {!days ? (
        <p className="fc-loading" role="status">Loading daily data…</p>
      ) : (
        <>
          {flag && (
            <p className={`fc-ew-flag ${flag}`} role="status">
              {flag === "high" ? "Unusually high: recent activity is in the top 10% of the same window in earlier years." : "Elevated: the last 7 days are in the top quarter of earlier years."}
            </p>
          )}
          <div className="fc-ew-grid">
            {w7 && <WindowTile w={w7} unit={unit} title="Last 7 days" />}
            {w30 && <WindowTile w={w30} unit={unit} title="Last 30 days" />}
            {outlook && (
              <div className="fc-stat fc-ew-tile">
                <span className="fc-stat-label">Next 4 weeks, historically ({outlook.start.slice(5)} – {outlook.end.slice(5)})</span>
                <strong>{fmt(outlook.median)}</strong>
                <span className="fc-stat-note">median {unit} over {outlook.years} earlier years</span>
                <span className="fc-stat-note">90th percentile {fmt(outlook.p90)}{outlook.max ? ` · largest ${fmt(outlook.max.value)} (${outlook.max.year})` : ""}</span>
              </div>
            )}
          </div>
          <p className="fc-verdict">
            {periods.length === 0
              ? "No recurring critical period in this area's record."
              : current
                ? `Now inside the typical critical period ${doyLabel(current.start)} – ${doyLabel(current.end)} (climatological peak ${doyLabel(current.peak)}).`
                : upcoming
                  ? `A typical critical period starts within 4 weeks: ${doyLabel(upcoming.start)} – ${doyLabel(upcoming.end)} (peak ${doyLabel(upcoming.peak)}).`
                  : `Outside the typical critical period${periods.length > 1 ? "s" : ""}: ${periods.slice(0, 3).map((p) => `${doyLabel(p.start)} – ${doyLabel(p.end)} (peak ${doyLabel(p.peak)})`).join("; ")}.`}
          </p>
          <p className="fc-note">Critical period: days of the year when the {climYears}-year median of 15-day average activity is at least half its seasonal peak. An outlook is the historical range for the same weeks, not a forecast.</p>
        </>
      )}
    </section>
  );
}
