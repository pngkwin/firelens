import { useMemo } from "react";
import type { MonthResult } from "../data/v2/series";
import type { FireEvent } from "../data/v2/events";
import { rankEvents } from "../data/v2/events";
import { SCALES, type Scale } from "../data/v2/analysis";
import { fmt } from "./colors";

type Props = { events: FireEvent[] | null; note: string; months: MonthResult[]; scale: Scale; dataEnd: string; progress: string; onFocus: (month: string) => void };

const ord = (p: number) => (Number.isFinite(p) ? `${fmt(p)}th percentile` : "–");

export function EventsPanel({ events, note, months, scale, dataEnd, progress, onFocus }: Props) {
  const byMonth = useMemo(() => new Map(months.map((m) => [m.month, m])), [months]);
  const r = useMemo(() => (events ? rankEvents(events, scale, byMonth, dataEnd, 7) : null), [events, scale, byMonth, dataEnd]);
  const unit = SCALES[scale].unit;
  return (
    <section className="fc-panel fc-events" aria-labelledby="fc-events-title">
      <div className="fc-panel-head">
        <h2 id="fc-events-title">Current fire vs past fires</h2>
        <p className="fc-sub">
          Fire episodes: burning cells (~250 km²) that touch and burn within one day of each other, grouped inside the selected area. Sizes in {SCALES[scale].label.toLowerCase()}.
        </p>
      </div>
      {!r ? (
        <p className={note ? "fc-note" : "fc-loading"} role="status">{note || progress || "Grouping fire episodes…"}</p>
      ) : (
        <>
          <h3 className="fc-h3">Active in the last 7 days (since {r.cutoff})</h3>
          {r.current.length === 0 ? (
            <p className="fc-note">No fire episodes with detections in the last 7 days in this area (no matching records in the loaded data).</p>
          ) : (
            <table className="fc-table">
              <caption className="fc-sr">Current fire episodes ranked against {r.pastCount} past episodes</caption>
              <thead><tr><th scope="col">Episode</th><th scope="col">Size ({unit})</th><th scope="col">Size rank</th><th scope="col">Duration</th><th scope="col">Peak day</th><th scope="col">Cells</th></tr></thead>
              <tbody>
                {r.current.slice(0, 8).map((e) => (
                  <tr key={e.start + e.centre.join()}>
                    <td>{e.start} – {e.end}<span className="fc-dim"> · near {e.centre[1].toFixed(2)}, {e.centre[0].toFixed(2)}</span></td>
                    <td className="num">{fmt(e.size)}</td>
                    <td className="num">{e.rankSize} of {r.pastCount + 1}<span className="fc-dim"> ({ord(e.pctSize)})</span></td>
                    <td className="num">{e.days} d<span className="fc-dim"> ({ord(e.pctDays)})</span></td>
                    <td className="num">{e.peakDay}: {fmt(e.peak)}<span className="fc-dim"> ({ord(e.pctPeak)})</span></td>
                    <td className="num">{e.cells}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="fc-h3">Largest past episodes in this area</h3>
          <table className="fc-table">
            <caption className="fc-sr">Ten largest past fire episodes</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Dates</th><th scope="col">Size ({unit})</th><th scope="col">Duration</th><th scope="col">Peak day</th><th scope="col">Cells</th></tr></thead>
            <tbody>
              {r.largestPast.map((e, i) => (
                <tr key={e.start + e.centre.join()}>
                  <td>{i + 1}</td>
                  <td><button type="button" className="text-button" onClick={() => onFocus(e.peakDay.slice(0, 7))}>{e.start} – {e.end}</button></td>
                  <td className="num">{fmt(e.size)}</td>
                  <td className="num">{e.days} d</td>
                  <td className="num">{e.peakDay}: {fmt(e.peak)}</td>
                  <td className="num">{e.cells}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fc-note">
            {r.pastCount.toLocaleString()} past episodes in this area. Percentiles compare with all of them (most are single-cell, single-day). Persistent agricultural or prescribed burning in neighbouring cells forms long episodes; check duration and cell count. Selecting dates opens that month in the calendar.
          </p>
        </>
      )}
    </section>
  );
}
