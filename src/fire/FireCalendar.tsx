import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { parseState, serializeState, type RegionId, type ViewState } from "../data/v2/urlState";
import { SCALES, type Scale } from "../data/v2/analysis";
import type { Aoi } from "../data/v2/aoi";
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
import type { DrawMode } from "./AoiMap";
const AoiMap = lazy(() => import("./AoiMap").then((m) => ({ default: m.AoiMap })));
const TrendPanel = lazy(() => import("./TrendPanel").then((m) => ({ default: m.TrendPanel })));

const HOME: Record<RegionId, [number, number, number, number]> = { us: [-125, 24, -66, 50], iberia: [-10, 36, 4, 44] };

export function FireCalendar() {
  const initial = useMemo(() => parseState(window.location.search), []);
  const [state, setState] = useState<ViewState>(initial.state);
  const [urlErrors] = useState(initial.errors);
  const [mode, setMode] = useState<DrawMode>("none");
  const [copied, setCopied] = useState(false);
  const data = useFireData(state.region, state.aoi);
  const set = useCallback((patch: Partial<ViewState>) => setState((s) => ({ ...s, ...patch })), []);
  const onAoi = useCallback((aoi: Aoi) => set({ aoi }), [set]);

  const first = data.months[0]?.month, last = data.months.at(-1)?.month;
  const from = state.from && first && state.from >= first ? state.from : first ?? "2000-11";
  const to = state.to && last && state.to <= last ? state.to : last ?? "2026-11";
  const focus = state.focus && data.months.some((m) => m.month === state.focus) ? state.focus : last ?? null;

  useEffect(() => {
    const q = serializeState(state);
    if (q !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${q}${window.location.hash}`);
  }, [state]);

  const presetsName = aoiLabel(state.aoi, data.presets, state.region);
  const provisionalFrom = data.live.days.find((d) => d.provisional)?.day ?? null;
  const monthOptions = data.months.map((m) => m.month);
  const coverStart = `${first ?? "2000-11"}-01`;
  const clim = useMemo(() => (data.days && data.dataEnd ? dailyClimatology(data.days, state.scale, coverStart, data.dataEnd) : null), [data.days, data.dataEnd, state.scale, coverStart]);
  const periods = useMemo(() => (clim ? criticalPeriods(clim.median, 0.5) : []), [clim]);

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
        <button type="button" className="button small" onClick={async () => { await navigator.clipboard?.writeText(window.location.href).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? "Link copied" : "Copy share link"}
        </button>
        <span className="fc-status" role="status">
          {data.status === "loading" ? data.progress || "Loading…" : data.status === "error" ? "Error" : `Data through ${data.dataEnd}${data.live.days.length ? ` (incl. ${data.live.days.length} live NRT day${data.live.days.length > 1 ? "s" : ""})` : ""} · query ${fmt(data.timing.monthlyMs / 1000, 2)} s (load ${fmt(data.timing.loadMs / 1000, 2)} s, compute ${fmt(data.timing.computeMs / 1000, 2)} s${data.timing.liveMs ? `; live backend ${fmt(data.timing.liveMs / 1000, 2)} s, merged after` : ""})${data.progress ? ` · ${data.progress}` : ""}`}
        </span>
      </div>
      {urlErrors.length > 0 && <p className="fc-error" role="alert">Some link settings were ignored: {urlErrors.join(" ")}</p>}
      {data.status === "error" && <p className="fc-error" role="alert">{data.error}</p>}

      <div className="fc-top">
        <div className="fc-side">
          <AoiPanel region={state.region} onRegion={(region) => setState({ ...state, region, aoi: { kind: "region" }, focus: null })} aoi={state.aoi} polys={data.polys} presets={data.presets} cellsInAoi={data.cellsInAoi} onAoi={onAoi} />
          <Suspense fallback={<div className="fc-map-wrap fc-loading">Loading map…</div>}>
            <AoiMap polys={data.polys} overview={data.overview} fromYear={+from.slice(0, 4)} toYear={+to.slice(0, 4)} home={HOME[state.region]} mode={mode} onMode={setMode} onAoi={onAoi} />
          </Suspense>
        </div>
        <div className="fc-main">
          {data.status === "ready" && focus && <FocusCard months={data.months} days={data.days} focus={focus} scale={state.scale} dataEnd={data.dataEnd!} provisionalFrom={provisionalFrom} />}
          {data.status === "ready" && <EarlyWarning days={data.days} scale={state.scale} coverStart={coverStart} dataEnd={data.dataEnd!} periods={periods} climYears={clim?.years ?? 0} provisionalFrom={provisionalFrom} />}
          {data.status === "ready" && <MonthHeatmap months={data.months} scale={state.scale} from={from} to={to} focus={focus} onFocus={(m) => set({ focus: m })} />}
        </div>
      </div>
      {data.status === "ready" && (
        <>
          <div className="fc-two">
            <Rankings months={data.months} scale={state.scale} from={from} to={to} onFocus={(m) => set({ focus: m })} />
            <Suspense fallback={<div className="fc-panel fc-loading">Loading chart…</div>}>
              <TrendPanel months={data.months} scale={state.scale} from={from} to={to} />
            </Suspense>
          </div>
          <EventsPanel events={data.events} note={data.eventsNote} months={data.months} scale={state.scale} dataEnd={data.dataEnd!} progress={data.progress} onFocus={(m) => set({ focus: m })} />
          <DoyHeatmap days={data.days} scale={state.scale} from={from} to={to} progress={data.progress} coverStart={coverStart} dataEnd={data.dataEnd!} periods={periods} />
          <ExportPanel data={data} region={state.region} aoi={state.aoi} aoiName={presetsName} from={from} to={to} scale={state.scale} />
          <MethodNote data={data} />
        </>
      )}
    </div>
  );
}

function MethodNote({ data }: { data: ReturnType<typeof useFireData> }) {
  const cal = data.cal!, sel = cal.selection;
  const iv = cal.interval90, tiv = cal.terraInterval90;
  return (
    <section className="fc-panel fc-method" aria-labelledby="fc-method-title">
      <h2 id="fc-method-title">How to read these numbers</h2>
      <ul>
        <li><strong>Unit:</strong> a fire-cell-day is one ~0.74 km² H3 cell on one UTC day with at least one detection. Sensors are combined as a union (a cell burning for two satellites counts once), never summed. A zero means no matching records in the loaded data, not that no fire occurred.</li>
        <li><strong>MODIS-equivalent (main scale):</strong> observed MODIS Terra ∪ Aqua for 2002-07 – 2021-12. <em>Estimated</em> before 2002-07 (Terra-only scaled to Terra ∪ Aqua; 90% interval ×{fmt(tiv?.lo, 3)}–{fmt(tiv?.hi, 3)}) and from 2022 (from VIIRS, because the MODIS orbits drift; {sel.selected === "qm" ? "quantile mapping" : "stratified ratio by zone, month and day/night"}; 90% interval ×{fmt(iv?.lo, 3)}–{fmt(iv?.hi, 3)}, measured coverage {fmt((iv?.outOfSampleCoverage ?? 0) * 100)}%, wider for small areas).</li>
        <li><strong>Method {cal.method}:</strong> {sel.rule} Held-out monthly MAE here: stratified {fmt(sel.looMonthlyMae.stratified)}, quantile mapping {fmt(sel.looMonthlyMae.qm)}, single ratio {fmt(sel.looMonthlyMae.global)} fire-cell-days.</li>
        <li><strong>VIIRS-level (secondary scale):</strong> VIIRS reference on the S-NPP scale (NOAA-20/21 cross-calibrated) where VIIRS exists; before 2012 it is MODIS-equivalent × a month-of-year ratio (estimated, interval not quantified).</li>
        <li><strong>Raw scales</strong> show each sensor as observed. Comparing raw MODIS with raw VIIRS shows the sensor difference that harmonization removes (VIIRS detects about twice as many fire-cell-days).</li>
        <li><strong>Hotspot scales</strong> count FIRMS detections (one per satellite pixel per overpass: 1 km for MODIS, 375 m for VIIRS) after the region clip and static-source mask. They are never added across sensors, because one fire seen by several satellites would be counted several times; VIIRS's smaller pixels also split one fire into more hotspots. The harmonized MODIS-equivalent scale is the comparable count over time.</li>
        <li><strong>Data:</strong> NASA FIRMS science-quality archive to {data.manifest!.planEnd} (verified bundle), near-real-time after; {data.live.status.configured ? `${data.live.days.length} live day(s) from the backend${data.live.status.error ? ` (backend error: ${data.live.status.error})` : ""}` : "live backend not configured"}. S-NPP stopped on 2026-11-02; current VIIRS comes from NOAA-20 and NOAA-21. Static industrial and volcanic sources are masked ({fmt(data.manifest!.product.staticSourceMask.cells)} cells).</li>
      </ul>
      <p className="fc-note">Full method and validation: docs/harmonization-method.md and docs/harmonization-validation.md.</p>
    </section>
  );
}
