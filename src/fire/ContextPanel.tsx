import { useMemo } from "react";
import type { MonthResult } from "../data/v2/series";
import type { Aoi } from "../data/v2/aoi";
import type { RegionId } from "../data/v2/urlState";
import { compareFocus } from "../data/v2/analysis";
import { incidentsFor, type Incident } from "../data/v2/incidents";
import { CASES } from "../data/v2/casebook";
import { fmt, monthLabel } from "./colors";

type Props = { region: RegionId; aoi: Aoi; areaName: string; months: MonthResult[]; onExamine: (i: Incident, how: "area" | "origin") => void; onFocus: (m: string) => void };
export const ORIGIN_RADIUS_KM = 50;

/** Does the current selection contain this incident's reference area? */
export const selectionMatches = (i: Incident, aoi: Aoi) => (i.preset ? aoi.kind === "preset" && aoi.id === i.preset : aoi.kind === "region");

/** Independently documented incidents next to the satellite detection record for the same months. */
export function ContextPanel({ region, aoi, areaName, months, onExamine, onFocus }: Props) {
  const list = incidentsFor(region);
  const rows = useMemo(() => list.map((i) => ({
    i,
    match: selectionMatches(i, aoi),
    months: i.months.map((m) => {
      const r = months.find((x) => x.month === m);
      const c = r ? compareFocus(months, null, m, "modis-eq") : null;
      return { m, r, c };
    }),
  })), [list, aoi, months]);
  const caseName = (id: string) => CASES.find((c) => c.id === id)?.area ?? id;
  return (
    <section className="fc-panel" aria-labelledby="fc-context-title">
      <div className="fc-panel-head">
        <h2 id="fc-context-title">Documented fires: independent records next to the satellite record</h2>
        <p className="fc-sub">A small, curated set of incidents from fire agencies and the Copernicus Emergency Management Service that give context to the research cases. Every date, place and size is quoted from the linked source; FireLens adds the satellite detections for the same months. This is not a complete fire inventory, and agency acreage (burned area) and fire-cell-days (daily satellite detections) measure different things: neither is converted into the other.</p>
      </div>
      <div className="fc-incidents">
        {rows.map(({ i, match, months: ms }) => (
          <article key={i.id} className="fc-incident" aria-labelledby={`inc-${i.id}`}>
            <h3 id={`inc-${i.id}`} className="fc-h3">{i.name}</h3>
            <p className="fc-dim">{i.place} · from {i.start}{i.end ? ` to ${i.end}` : ""}{i.size ? ` · ${i.size}` : ""} · context for the {caseName(i.caseId)} case</p>
            <p>{i.note}</p>
            {match ? (
              <ul className="fc-list">
                {ms.map(({ m, r, c }) => (
                  <li key={m}>
                    <button type="button" className="text-button" onClick={() => onFocus(m)}>{monthLabel(m)}</button> in {areaName}:{" "}
                    {r?.value == null ? "no harmonized value" : <>
                      {fmt(r.value)} MODIS-equivalent fire-cell-days{r.cls === "modis-observed" ? " (observed MODIS)" : ` (estimated, 90% ${fmt(r.lo)}–${fmt(r.hi)})`}
                      {c?.stats ? `, ${fmt(c.stats.pctOfMedian)}% of the median for that month in ${c.stats.n} comparable years (percentile ${fmt(c.stats.percentile)})` : c?.blocked ? ` (${c.blocked})` : ""}
                    </>}
                  </li>
                ))}
              </ul>
            ) : <p className="fc-note">Select {i.preset ? "the state this incident is in" : "the whole region"} to see the satellite record for {i.months.map(monthLabel).join(", ")}.</p>}
            <div className="fc-actions">
              <button type="button" className="button small" onClick={() => onExamine(i, "area")}>{match ? "Show these months" : `Open ${i.preset ? "the state" : "the region"} at ${monthLabel(i.months[0])}`}</button>
              {i.location && <button type="button" className="button small" onClick={() => onExamine(i, "origin")}>Area within {ORIGIN_RADIUS_KM} km of the published origin</button>}
            </div>
            <p className="fc-dim">Source{i.source.length > 1 ? "s" : ""}: {i.source.map((s, k) => <span key={s.url}>{k ? "; " : ""}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.publisher}</a></span>)}</p>
          </article>
        ))}
      </div>
      <details className="fc-details">
        <summary>How to read this, and its limits</summary>
        <ul className="fc-list">
          <li>Point locations are shown on the map only where the agency publishes one (CAL FIRE incident coordinates, usually the origin). They are not perimeters; fire perimeters (e.g. MTBS, NIFC) are not included in this version.</li>
          <li>The "{ORIGIN_RADIUS_KM} km of the published origin" area is a circle of whole ~250 km² cells around that point: it also contains other fires, and large fires extend beyond it.</li>
          <li>A record area burned does not imply a record month of fire-cell-days: a wind-driven grass fire can burn a vast area in a few days (few cell-days), while a long season of many fires accumulates many cell-days.</li>
          <li>Records were checked against the linked pages on 2026-11-15. Later agency revisions of acreage are not tracked.</li>
        </ul>
      </details>
    </section>
  );
}
