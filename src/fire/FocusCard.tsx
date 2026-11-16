import { useMemo } from "react";
import type { DayResult, MonthResult } from "../data/v2/series";
import { compareFocus, SCALES, SCALE_PLATFORMS, type Scale } from "../data/v2/analysis";
import { ESTIMATE_LABEL } from "../data/v2/exportsV2";
import { diverging, fmt, monthLabel, textOn } from "./colors";

type Props = { months: MonthResult[]; days: DayResult[] | null; focus: string; scale: Scale; dataEnd: string; provisionalFrom: string | null };

export function FocusCard({ months, days, focus, scale, dataEnd, provisionalFrom }: Props) {
  const c = useMemo(() => compareFocus(months, days, focus, scale), [months, days, focus, scale]);
  const r = months.find((m) => m.month === focus);
  if (!r) return null;
  const s = c?.stats;
  const fill = diverging(s?.pctOfMedian ?? null);
  const fillMean = diverging(s?.pctOfMean ?? null);
  const provisional = provisionalFrom != null && focus === dataEnd.slice(0, 7) && dataEnd >= provisionalFrom;
  return (
    <section className="fc-panel fc-focus" aria-labelledby="fc-focus-title">
      <div className="fc-panel-head">
        <h2 id="fc-focus-title">
          {monthLabel(focus)} vs other years
        </h2>
        <p className="fc-sub">
          {c?.mode === "month-to-date" || (!c && r.daysCovered < r.daysInMonth)
            ? `Month to date: days 1–${r.daysCovered} compared with the same days in every year with a complete, fully observed ${monthLabel(focus).slice(0, 3)}`
            : `Whole month compared with every other year's ${monthLabel(focus).slice(0, 3)} that the satellites observed in full`}
          {SCALE_PLATFORMS[scale] ? " by the same set of satellites." : "."}
          {provisional && " Latest days are provisional near-real-time data."}
        </p>
      </div>
      {!c ? (
        <p className="fc-loading" role="status">Loading daily data for the month-to-date comparison…</p>
      ) : (
        <>
          <p className="sr-only" role="status">
            {c.status.available ? `${monthLabel(focus)}: ${fmt(c.value)} ${SCALES[scale].short} ${SCALES[scale].unit}${s?.pctOfMedian == null ? "" : `, ${fmt(s.pctOfMedian)}% of median`}${c.blocked ? ", not compared with other years" : ""}.` : `${monthLabel(focus)}: not observed on this scale.`}
          </p>
          <div className="fc-focus-grid">
            <div className="fc-stat big">
              <span className="fc-stat-label">{SCALES[scale].short} {SCALES[scale].unit}</span>
              <strong>{c.status.available ? fmt(c.value) : "–"}</strong>
              {c.interval && <span className="fc-stat-note">90% interval {fmt(c.interval[0])}–{fmt(c.interval[1])}</span>}
              <span className={`fc-badge${c.estimated ? " est" : ""}`}>{!c.status.available ? "Not observed" : SCALES[scale].harmonized ? (c.estimated ? ESTIMATE_LABEL[r.method] : "Observed MODIS") : "Raw observation"}</span>
              {c.status.reduced && <span className="fc-badge warn">Reduced satellite coverage</span>}
              {SCALES[scale].harmonized && r.cls === "viirs-estimated" && r.viirsPlatform && r.viirsPlatform !== "S-NPP" && <span className="fc-stat-note">VIIRS reference: {r.viirsPlatform} (scaled to S-NPP)</span>}
            </div>
            {!c.blocked && (<>
            <div className="fc-stat">
              <span className="fc-stat-label">Historical median ({s?.n ?? 0} years)</span>
              <strong>{fmt(s?.median)}</strong>
              <span className="fc-stat-note">multi-year average {fmt(s?.mean)}</span>
            </div>
            <div className="fc-stat filled" style={{ background: fill, color: textOn(fill) }}>
              <span className="fc-stat-label">% of median</span>
              <strong>{s?.pctOfMedian == null ? "–" : `${fmt(s.pctOfMedian)}%`}</strong>
            </div>
            <div className="fc-stat filled" style={{ background: fillMean, color: textOn(fillMean) }}>
              <span className="fc-stat-label">% of multi-year average</span>
              <strong>{s?.pctOfMean == null ? "–" : `${fmt(s.pctOfMean)}%`}</strong>
              <span className="fc-stat-note">{s ? `${s.diffFromMean >= 0 ? "+" : ""}${fmt(s.diffFromMean)} vs average` : ""}</span>
            </div>
            <div className="fc-stat">
              <span className="fc-stat-label">Percentile</span>
              <strong>{fmt(s?.percentile)}</strong>
              <span className="fc-stat-note">rank {s?.rank} of {s?.of}</span>
            </div>
            <div className="fc-stat">
              <span className="fc-stat-label">Anomaly (z-score)</span>
              <strong>{s?.z == null ? "–" : (s.z >= 0 ? "+" : "") + fmt(s.z, 2)}</strong>
            </div>
            </>)}
          </div>
          {c.blocked ? (
            <p className="fc-verdict">{c.blocked}</p>
          ) : (
          <p className="fc-verdict">
            {s == null
              ? "No comparable years in the loaded data."
              : c.boundsAgree === "above"
                ? `Above the historical median${c.interval ? " even at the lower end of the 90% interval" : ""}.`
                : c.boundsAgree === "below"
                  ? `Below the historical median${c.interval ? " even at the upper end of the 90% interval" : ""}.`
                  : c.interval
                    ? "The 90% interval includes the historical median: not distinguishable from a typical year."
                    : "Equal to the historical median."}{" "}
            Range in other years: {fmt(s?.min)}–{fmt(s?.max)}.
          </p>
          )}
        </>
      )}
    </section>
  );
}
