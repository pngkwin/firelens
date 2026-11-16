import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { parseState, REGIONS, serializeState, type RegionId, type ViewState } from "../data/v2/urlState";
import { dayStatus, SCALES, type Scale } from "../data/v2/analysis";
import { encodeAoi, type Aoi } from "../data/v2/aoi";
import type { BriefInput } from "../data/v2/brief";
import type { Case } from "../data/v2/casebook";
import { CASES } from "../data/v2/casebook";
import { Investigate } from "./Investigate";
import { useFireData } from "./useFireData";
import { MonthHeatmap } from "./MonthHeatmap";
import { FocusCard } from "./FocusCard";
import { Rankings } from "./Rankings";
import { AoiPanel, aoiLabel } from "./AoiPanel";
import { ExportPanel } from "./ExportPanel";
import { DoyHeatmap } from "./DoyHeatmap";
import { EarlyWarning } from "./EarlyWarning";
import { EventsPanel } from "./EventsPanel";
import { criticalPeriods, dailyClimatology } from "../data/v2/earlyWarning";
import { fmt } from "./colors";
import { SelectField } from "./SelectField";
import type { DrawMode, MapPoint } from "./AoiMap";
import { incidentsFor, type Incident } from "../data/v2/incidents";
import { ORIGIN_RADIUS_KM, selectionMatches } from "./ContextPanel";
const AoiMap = lazy(() => import("./AoiMap").then((m) => ({ default: m.AoiMap })));
const TrendPanel = lazy(() => import("./TrendPanel").then((m) => ({ default: m.TrendPanel })));
const DisagreementAtlas = lazy(() => import("./DisagreementAtlas").then((m) => ({ default: m.DisagreementAtlas })));
const TransitionPanel = lazy(() => import("./TransitionPanel").then((m) => ({ default: m.TransitionPanel })));
const EvidenceLab = lazy(() => import("./EvidenceLab").then((m) => ({ default: m.EvidenceLab })));
const SeasonPanel = lazy(() => import("./SeasonPanel").then((m) => ({ default: m.SeasonPanel })));
const ContextPanel = lazy(() => import("./ContextPanel").then((m) => ({ default: m.ContextPanel })));
const RegionalBrief = lazy(() => import("./RegionalBrief").then((m) => ({ default: m.RegionalBrief })));

const HOME: Record<RegionId, [number, number, number, number]> = { us: [-125, 24, -66, 50], iberia: [-10, 36, 4, 44] };

export function FireCalendar() {
  const initial = useMemo(() => parseState(window.location.search), []);
  const [state, setState] = useState<ViewState>(initial.state);
  const [urlErrors] = useState(initial.errors);
  const [mode, setMode] = useState<DrawMode>("none");
  const [copied, setCopied] = useState<"" | "ok" | "failed">("");
  const data = useFireData(state.region, state.aoi);
  const set = useCallback((patch: Partial<ViewState>) => setState((s) => ({ ...s, ...patch })), []);
  const onAoi = useCallback((aoi: Aoi) => set({ aoi }), [set]);

  const first = data.months[0]?.month, last = data.months.at(-1)?.month;
  const from = state.from && first && state.from >= first ? state.from : first ?? "2000-11";
  const to = state.to && last && state.to <= last ? state.to : last ?? "2026-11";
  // The focus month stays inside From–To: a month outside the range falls back to the range end.
  const focus = state.focus && state.focus >= from && state.focus <= to && data.months.some((m) => m.month === state.focus) ? state.focus : last ? to : null;

  useEffect(() => {
    const q = serializeState(state);
    if (q !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${q}${window.location.hash}`);
  }, [state]);

  const presetsName = aoiLabel(state.aoi, data.presets, state.region);
  const provisionalFrom = data.live.days.find((d) => d.provisional)?.day ?? null;
  const monthOptions = data.months.map((m) => m.month);
  const coverStart = `${first ?? "2000-11"}-01`;
  // Day-level observation check (pre-launch days, satellite outages) for windows and the day-of-year chart.
  const obs = useMemo(() => {
    const byMonth = new Map(data.months.map((m) => [m.month, m]));
    const cov = data.cal?.coverage;
    return (day: string) => dayStatus(day, state.scale, cov, byMonth.get(day.slice(0, 7)));
  }, [data.months, data.cal, state.scale]);
  const clim = useMemo(() => (data.days && data.dataEnd ? dailyClimatology(data.days, state.scale, coverStart, data.dataEnd, 15, obs) : null), [data.days, data.dataEnd, state.scale, coverStart, obs]);
  const periods = useMemo(() => (clim ? criticalPeriods(clim.median, 0.5) : []), [clim]);
  const openCase = useCallback((c: Case) => {
    setState((s) => ({ ...s, region: c.region, aoi: c.aoi, from: c.from, to: c.to, focus: c.focus, scale: "modis-eq", tab: c.startTab ?? "transition" }));
    requestAnimationFrame(() => document.getElementById("fc-tabpanel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const examine = useCallback((i: Incident, how: "area" | "origin") => {
    const aoi: Aoi = how === "origin" && i.location ? { kind: "circle", center: i.location, radiusKm: ORIGIN_RADIUS_KM } : i.preset ? { kind: "preset", id: i.preset } : { kind: "region" };
    const y = +i.months[0].slice(0, 4);
    setState((s) => ({ ...s, region: i.region, aoi, from: s.region === i.region && s.from && s.from <= i.months[0] ? s.from : `${Math.max(2001, y - 10)}-01`, to: s.region === i.region && s.to && s.to >= i.months.at(-1)! ? s.to : `${Math.min(2025, y + 2)}-12`, focus: i.months[0], scale: "modis-eq", tab: "context" }));
  }, []);
  const mapPoints = useMemo<MapPoint[] | undefined>(() => state.tab === "context" ? incidentsFor(state.region).filter((i) => i.location).map((i) => ({ lon: i.location![0], lat: i.location![1], label: i.name })) : undefined, [state.tab, state.region]);
  const activeCase = CASES.find((c) => c.region === state.region && encodeAoi(c.aoi) === encodeAoi(state.aoi) && c.focus === focus)?.id ?? null;
  const briefInput = useMemo<BriefInput | null>(() => (data.status !== "ready" || !data.cal || !data.manifest ? null : {
    regionName: REGIONS[state.region], areaName: presetsName, aoiEncoded: state.aoi.kind === "region" ? "" : encodeAoi(state.aoi),
    cellRule: "H3 res-5 cells (~250 km²) whose centre lies inside the area",
    boundary: state.aoi.kind === "preset" ? (state.region === "us" ? "US Census 1:10M state boundary (us-atlas)" : "Natural Earth 1:50M country boundary (world-atlas)") : state.aoi.kind === "region" ? String((data.manifest.product.clip as { source?: string }).source ?? "region clip polygon") : "user-defined geometry",
    months: data.months, from, to, focus, dataEnd: data.dataEnd!, cal: data.cal, calSha: data.calSha!, manifestSha: data.manifestSha!, filesUsed: data.filesUsed.length,
    events: data.events, url: window.location.href, isSubArea: !!data.polys,
    incidents: incidentsFor(state.region).filter((i) => selectionMatches(i, state.aoi)),
  }), [data, state.region, state.aoi, presetsName, from, to, focus]);

  return (
    <div className="fc-root">
      <div className="fc-toolbar" role="group" aria-label="Calendar settings">
        <SelectField className="inline" label="Scale" value={state.scale} onChange={(v) => set({ scale: v as Scale })}>
          {Object.entries(SCALES).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
        </SelectField>
        <SelectField className="inline" label="From" value={from} onChange={(v) => set({ from: v })} disabled={!monthOptions.length}>
          {monthOptions.filter((m) => m <= to).map((m) => <option key={m} value={m}>{m}</option>)}
        </SelectField>
        <SelectField className="inline" label="To" value={to} onChange={(v) => set({ to: v })} disabled={!monthOptions.length}>
          {monthOptions.filter((m) => m >= from).map((m) => <option key={m} value={m}>{m}</option>)}
        </SelectField>
        <button type="button" className="button small" onClick={() => set({ from: null, to: null })}>Full record</button>
        <button type="button" className="button small" onClick={async () => {
          const ok = await copyText(window.location.href);
          setCopied(ok ? "ok" : "failed");
          setTimeout(() => setCopied(""), ok ? 2000 : 6000);
        }}>
          {copied === "ok" ? "Link copied" : "Copy share link"}
        </button>
        <span className="fc-status">
          {/* Only the short state is announced; timing details are plain text. */}
          <span role="status">
            {data.status === "loading" ? data.progress || "Loading…" : data.status === "error" ? "Error" : `Data through ${data.dataEnd}${data.live.days.length ? ` (incl. ${data.live.days.length} live NRT day${data.live.days.length > 1 ? "s" : ""})` : ""}`}
            {copied === "failed" ? " · Copy failed: copy the address from the address bar." : copied === "ok" ? " · Link copied." : ""}
          </span>
          {data.status === "ready" && ` · query ${fmt(data.timing.monthlyMs / 1000, 2)} s (load ${fmt(data.timing.loadMs / 1000, 2)} s, compute ${fmt(data.timing.computeMs / 1000, 2)} s${data.timing.liveMs ? `; live backend ${fmt(data.timing.liveMs / 1000, 2)} s, merged after` : ""})${data.progress ? ` · ${data.progress}` : ""}`}
        </span>
      </div>
      {urlErrors.length > 0 && <p className="fc-error" role="alert">Some link settings were ignored: {urlErrors.join(" ")}</p>}
      {data.status === "error" && <p className="fc-error" role="alert">{data.error}</p>}

      <div className="fc-top">
        <div className="fc-side">
          <AoiPanel region={state.region} onRegion={(region) => setState({ ...state, region, aoi: { kind: "region" }, focus: null })} aoi={state.aoi} polys={data.polys} presets={data.presets} cellsInAoi={data.cellsInAoi} onAoi={onAoi} />
          <Suspense fallback={<div className="fc-map-wrap fc-loading">Loading map…</div>}>
            <AoiMap polys={data.polys} overview={data.overview} points={mapPoints} layer={state.map} fromYear={+from.slice(0, 4)} toYear={+to.slice(0, 4)} home={HOME[state.region]} mode={mode} onMode={setMode} onAoi={onAoi} />
          </Suspense>
        </div>
        <div className="fc-main">
          {data.status === "ready" && focus && <FocusCard months={data.months} days={data.days} focus={focus} scale={state.scale} dataEnd={data.dataEnd!} provisionalFrom={provisionalFrom} />}
          {data.status === "ready" && <EarlyWarning days={data.days} scale={state.scale} obs={obs} coverStart={coverStart} dataEnd={data.dataEnd!} periods={periods} climYears={clim?.years ?? 0} provisionalFrom={provisionalFrom} />}
          {data.status === "ready" && <MonthHeatmap months={data.months} scale={state.scale} from={from} to={to} focus={focus} onFocus={(m) => set({ focus: m })} />}
        </div>
      </div>
      {data.status === "ready" && (
        <>
          <Investigate tab={state.tab} onTab={(tab) => set({ tab })} onCase={openCase} activeCase={activeCase}>
            <Suspense fallback={<div className="fc-panel fc-loading">Loading…</div>}>
              {state.tab === "season" && <SeasonPanel months={data.months} areaName={presetsName} isSubArea={!!data.polys} />}
              {state.tab === "context" && <ContextPanel region={state.region} aoi={state.aoi} areaName={presetsName} months={data.months} onExamine={examine} onFocus={(m) => set({ focus: m })} />}
              {state.tab === "atlas" && <DisagreementAtlas months={data.months} from={from} to={to} focus={focus} mapLayer={state.map} onMapLayer={(map) => set({ map })} onFocus={(m) => set({ focus: m })} />}
              {state.tab === "transition" && <TransitionPanel months={data.months} focus={focus} from={from} to={to} onFocus={(m) => set({ focus: m })} />}
              {state.tab === "evidence" && data.cal && <EvidenceLab cal={data.cal} calSha={data.calSha!} region={state.region} onFocus={(m) => set({ focus: m })} />}
              {state.tab === "brief" && <RegionalBrief input={briefInput} onFocus={(m) => set({ focus: m })} onTab={(tab) => set({ tab })} />}
            </Suspense>
          </Investigate>
          <div className="fc-two">
            <Rankings months={data.months} scale={state.scale} from={from} to={to} onFocus={(m) => set({ focus: m })} />
            <Suspense fallback={<div className="fc-panel fc-loading">Loading chart…</div>}>
              <TrendPanel months={data.months} scale={state.scale} from={from} to={to} />
            </Suspense>
          </div>
          <EventsPanel events={data.events} note={data.eventsNote} months={data.months} scale={state.scale} dataEnd={data.dataEnd!} progress={data.progress} onFocus={(m) => set({ focus: m })} />
          <DoyHeatmap days={data.days} scale={state.scale} obs={obs} from={from} to={to} progress={data.progress} coverStart={coverStart} dataEnd={data.dataEnd!} periods={periods} />
          <ExportPanel data={data} region={state.region} aoi={state.aoi} aoiName={presetsName} from={from} to={to} scale={state.scale} />
          <MethodNote data={data} />
        </>
      )}
    </div>
  );
}

/** Clipboard write that reports failure (missing API, insecure context, denied permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function MethodNote({ data }: { data: ReturnType<typeof useFireData> }) {
  const cal = data.cal!, sel = cal.selection;
  const iv = cal.interval90, tiv = cal.terraInterval90;
  return (
    <section className="fc-panel fc-method" aria-labelledby="fc-method-title">
      <h2 id="fc-method-title">How to read these numbers</h2>
      <ul>
        <li><strong>Scope:</strong> the complete record from November 2000 for two supported regions, the United States (contiguous, Alaska, Hawaii) and the Iberian Peninsula. FireLens is not a global historical database. The latest month is incomplete (data through {data.dataEnd}); incomplete months are marked and never treated as full months in baselines, seasonal profiles or trends.</li>
        <li><strong>Unit:</strong> a fire-cell-day is one ~0.74 km² H3 cell on one UTC day with at least one detection. Sensors are combined as a union (a cell burning for two satellites counts once), never summed. A zero means no matching records in the loaded data, not that no fire occurred.</li>
        <li><strong>MODIS-equivalent (main scale):</strong> observed MODIS Terra ∪ Aqua for 2002-07 – 2021-12. <em>Estimated</em> before 2002-07 (Terra-only scaled to Terra ∪ Aqua; 90% interval ×{fmt(tiv?.lo, 3)}–{fmt(tiv?.hi, 3)}) and from 2022 (from VIIRS, because the MODIS orbits drift; {sel.selected === "qm" ? "quantile mapping" : "stratified ratio by zone, month and day/night"}; 90% interval ×{fmt(iv?.lo, 3)}–{fmt(iv?.hi, 3)}, measured coverage {fmt((iv?.outOfSampleCoverage ?? 0) * 100)}%, wider for small areas).</li>
        <li><strong>Method {cal.method}:</strong> {sel.rule} Held-out monthly MAE here (every parameter refitted without the held-out year): stratified {fmt(sel.looMonthlyMae.stratified)}, quantile mapping {fmt(sel.looMonthlyMae.qm)}, single ratio {fmt(sel.looMonthlyMae.global)}{sel.nested ? `; nested score of the whole procedure ${fmt(sel.nested.mae)}` : ""} fire-cell-days. Validation is against MODIS itself (the target scale), not against ground-truth fires.</li>
        <li><strong>Observation coverage:</strong> a satellite-day counts as an outage only when another satellite observing that day saw enough fire that this one should have too (or, for Terra alone in 2000–2002, the same days in every other year make zero detections implausible); {cal.coverage.events.filter((e) => e.status === "confirmed").length} of {cal.coverage.events.length} flagged runs match a NASA/NOAA outage notice (confirmed), the rest are suspected. The VIIRS reference skips a satellite with flagged days. A month whose source lost ≥ 5% of its expected detections is marked reduced coverage: it is a lower bound, has no anomaly statistics and is left out of baselines and trends. Outage days are shown as no observation, never as zero.</li>
        <li><strong>VIIRS-level (secondary scale):</strong> VIIRS reference on the S-NPP scale (NOAA-20/21 cross-calibrated) where VIIRS exists; before 2012 it is MODIS-equivalent × a month-of-year ratio (estimated, interval not quantified).</li>
        <li><strong>Raw scales</strong> show what the satellites in orbit detected. Raw VIIRS has no value before S-NPP (2012-01-20), not zero. Raw totals rise when satellites are added (NOAA-20 2018, NOAA-21 2023) and fall when one stops (S-NPP 2026-11-02), so raw comparisons, rankings and trends use only periods observed by the same satellites, and are withheld otherwise. Comparing raw MODIS with raw VIIRS shows the sensor difference that harmonization removes (VIIRS detects about twice as many fire-cell-days).</li>
        <li><strong>Hotspot scales</strong> count FIRMS detections (one per satellite pixel per overpass: 1 km for MODIS, 375 m for VIIRS) after the region clip and static-source mask. They are never added across sensors, because one fire seen by several satellites would be counted several times; VIIRS's smaller pixels also split one fire into more hotspots. The harmonized MODIS-equivalent scale is the comparable count over time.</li>
        <li><strong>Data:</strong> NASA FIRMS science-quality archive to {data.manifest!.planEnd} (verified bundle), near-real-time after; {data.live.status.configured ? `${data.live.days.length} live day(s) from the backend${data.live.status.error ? ` (backend error: ${data.live.status.error})` : ""}` : "live backend not configured"}. S-NPP stopped on 2026-11-02; current VIIRS comes from NOAA-20 and NOAA-21. Static industrial and volcanic sources are masked ({fmt(data.manifest!.product.staticSourceMask.cells)} cells).</li>
      </ul>
      <p className="fc-note">Full method and validation: docs/harmonization-method.md and docs/harmonization-validation.md.</p>
    </section>
  );
}
