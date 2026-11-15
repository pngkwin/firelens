import { useEffect, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  StaticHistoryRepository,
  type HistoryManifest,
} from "../data/historyRepository";
import { useStudy } from "../state/StudyContext";
import {
  availabilityText,
  countScale,
  type ActivityRow,
} from "../data/research";
import type { Sensor } from "../data/types";
import { StudyControls } from "./StudyControls";
type Analysis = {
  version: string;
  scope: { start: string; end: string };
  interpretation: string;
  scales: {
    resolution: number;
    unit: string;
    MODIS: number;
    VIIRS: number;
    both: number;
    unionBins: number;
    jaccard: number | null;
  }[];
  daynight: {
    sensor: Sensor;
    platform: string;
    daynight: string;
    count: number;
  }[];
  proximity: {
    pairs: number;
    MODISwithCandidate: number;
    VIIRSwithCandidate: number;
  };
};
const repository = new StaticHistoryRepository();
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export function HistoricalResearch() {
  const { filters } = useStudy();
  const [manifest, setManifest] = useState<HistoryManifest | null>(null),
    [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadError, setLoadError] = useState(""),
    [queryError, setQueryError] = useState(""),
    [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState(5),
    [unit, setUnit] = useState("month"),
    [platform, setPlatform] = useState("");
  const [result, setResult] = useState<{
    activity: ActivityRow[];
    geography: string;
    scope: string;
    milliseconds: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      repository.manifest(),
      repository
        .json("analysis-latest.json")
        .then((p) => repository.json(p.file, p.sha256)),
    ])
      .then(([m, a]) => {
        if (active) {
          if (a.version !== m.version)
            throw Error(
              "Analysis and historical dataset versions differ; regenerate analysis",
            );
          setManifest(m);
          setResolution(m.config.defaultResolution);
          setAnalysis(a);
        }
      })
      .catch((e) => {
        if (active) setLoadError(e.message);
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, []);
  // Results must never survive a changed filter while retaining the old scope label.
  useEffect(() => {
    controller.current?.abort();
    setResult(null);
    setQueryError("");
    setBusy(false);
  }, [
    filters.start,
    filters.end,
    filters.bounds,
    filters.sensor,
    platform,
    resolution,
  ]);
  async function query() {
    if (!manifest?.extent.start || !manifest.extent.end) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setQueryError("");
    setResult(null);
    const began = performance.now();
    const start = filters.start || manifest.extent.start,
      end = filters.end || manifest.extent.end;
    try {
      const data = await repository.query(
        manifest,
        {
          start,
          end,
          bounds: filters.bounds,
          sensor: filters.sensor === "all" ? undefined : filters.sensor,
          platform: platform || undefined,
          resolution,
        },
        current.signal,
      );
      if (!current.signal.aborted)
        setResult({
          ...data,
          scope: `${start} to ${end} · ${platform || "all platforms"} · ${filters.sensor === "all" ? "separate sensors" : filters.sensor} · H3 ${resolution}`,
          milliseconds: performance.now() - began,
        });
    } catch (e) {
      if (!current.signal.aborted)
        setQueryError(
          e instanceof Error ? e.message : "Historical query failed",
        );
    } finally {
      if (!current.signal.aborted) setBusy(false);
    }
  }
  if (loadError)
    return (
      <section className="methods-sources">
        <h3>Historical research</h3>
        <p role="status">
          {loadError}. Reload to retry historical research. The loaded-point
          workspace remains available.
        </p>
      </section>
    );
  if (!manifest || !analysis)
    return (
      <section className="methods-sources" aria-busy="true">
        <p>Loading historical research metadata…</p>
      </section>
    );
  const scales = analysis.scales.filter((s) => s.unit === unit);
  const years = result
    ? [...new Set(result.activity.map((r) => r.period.slice(0, 4)))]
    : [];
  const rowMap = new Map(result?.activity.map((r) => [r.period, r]));
  const countMax = Math.max(
      1,
      ...(result?.activity.flatMap((r) => [r.MODIS ?? 0, r.VIIRS ?? 0]) ?? []),
    ),
    scale = countScale(countMax);
  const focused =
    result?.activity.filter(
      (r) => !filters.month || r.period === filters.month,
    ) ?? [];
  return (
    <>
      <section
        className="methods-sources historical-research"
        aria-labelledby="sensor-analysis-title"
      >
        <h3 id="sensor-analysis-title">Sensor analysis</h3>
        <p>
          Precomputed archive study · {analysis.scope.start} to{" "}
          {analysis.scope.end}. All retained points and source type codes; this
          study does not change with workspace filters.
        </p>
        <label className="compact-select">
          Co-occurrence interval{" "}
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="day">Daily</option>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </label>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Spatial scale sensitivity"
        >
          <table>
            <caption>
              Occupied cell/time bins within shared sensor record dates
            </caption>
            <thead>
              <tr>
                <th>H3 resolution</th>
                <th>MODIS</th>
                <th>VIIRS</th>
                <th>Both</th>
                <th>Shared / union</th>
              </tr>
            </thead>
            <tbody>
              {scales.map((s) => (
                <tr key={s.resolution}>
                  <th scope="row">{s.resolution}</th>
                  <td>{s.MODIS.toLocaleString()}</td>
                  <td>{s.VIIRS.toLocaleString()}</td>
                  <td>{s.both.toLocaleString()}</td>
                  <td>
                    {s.jaccard === null
                      ? "—"
                      : (s.jaccard * 100).toFixed(1) + "%"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="inline-note">
          Tables scroll horizontally to show all columns on smaller screens.
        </p>
        <p>
          “Both” means at least one detection from each instrument in the same
          cell and interval. It does not require simultaneous acquisition.
          Coarser bins can group unrelated observations. H3 cell areas vary;
          these are occupied-bin counts, not densities.
        </p>
        <details>
          <summary>
            Day/night observations and acquisition-time proximity
          </summary>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Sensor day and night distribution"
          >
            <table>
              <caption>Original NASA day/night flags</caption>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Platform</th>
                  <th>Flag</th>
                  <th>Records</th>
                </tr>
              </thead>
              <tbody>
                {analysis.daynight.map((r) => (
                  <tr key={r.platform + r.daynight}>
                    <th scope="row">{r.sensor}</th>
                    <td>{r.platform}</td>
                    <td>
                      {r.daynight === "D"
                        ? "Day"
                        : r.daynight === "N"
                          ? "Night"
                          : r.daynight}
                    </td>
                    <td>{r.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {analysis.proximity.pairs.toLocaleString()} many-to-many candidate
            pairs lie within 2 km and 30 minutes UTC, involving{" "}
            {analysis.proximity.MODISwithCandidate.toLocaleString()} MODIS and{" "}
            {analysis.proximity.VIIRSwithCandidate.toLocaleString()} VIIRS
            records. These are unvalidated proximity candidates, not verified
            same-fire matches or detection accuracy.
          </p>
        </details>
        <p>{analysis.interpretation}</p>
        <p>
          <strong>Historical anomalies: insufficient history.</strong> Only one
          calendar year is loaded. Reusable baseline functions require at least
          three eligible prior years of the same month and an explicitly
          comparable series. That minimum is an implementation guard, not
          scientific validation.
        </p>
      </section>
      <section
        className="methods-sources historical-research"
        aria-labelledby="historical-overview-title"
      >
        <h3 id="historical-overview-title">Preprocessed historical overview</h3>
        <p>
          Query monthly partitions without loading individual observations. Uses
          shared region, date, and sensor filters; selected month focuses the
          chart. This archive preview excludes browser imports. Detailed hotspot
          inspection and record exports remain in the loaded-point workspace.
        </p>
        <StudyControls />
        <div className="history-query-controls">
          <label className="compact-select">
            Spatial resolution{" "}
            <select
              value={resolution}
              onChange={(e) => setResolution(+e.target.value)}
            >
              {manifest.config.resolutions.map((r) => (
                <option key={r} value={r}>
                  H3 {r}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-select">
            Platform{" "}
            <select
              aria-label="Historical platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              <option value="">All platforms</option>
              {[...new Set(manifest.distribution.map((d) => d.platform))].map(
                (p) => (
                  <option key={p}>{p}</option>
                ),
              )}
            </select>
          </label>
          <button
            className="button"
            onClick={query}
            disabled={busy || !manifest.extent.count}
          >
            {busy ? "Querying archives…" : "Query historical aggregates"}
          </button>
        </div>
        {queryError && (
          <p role="alert">
            {queryError}. Adjust the query or regenerate the historical assets.
          </p>
        )}
        <div aria-live="polite" aria-busy={busy}>
          {result && (
            <>
              <p>
                {result.scope}
                <br />
                <strong>{result.geography}</strong> · coverage unknown ·{" "}
                {result.milliseconds.toFixed(0)} ms in this browser.
              </p>
              <div
                className="calendar-scroll"
                role="region"
                aria-label="Aggregate historical calendar"
                tabIndex={0}
              >
                <table className="calendar-table">
                  <caption>
                    Historical monthly detection records, separate sensors · “—”
                    unknown or excluded · * partial record/date interval
                  </caption>
                  <thead>
                    <tr>
                      <th>Year / sensor</th>
                      {months.map((m) => (
                        <th key={m}>{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {years.map((year) =>
                      (["MODIS", "VIIRS"] as Sensor[]).map((sensor) => (
                        <tr key={year + sensor}>
                          <th scope="row">
                            {year} {sensor}
                          </th>
                          {months.map((m, i) => {
                            const row = rowMap.get(
                                `${year}-${String(i + 1).padStart(2, "0")}`,
                              ),
                              n = row?.[sensor] ?? null,
                              status = row?.[`${sensor}_status`];
                            return (
                              <td key={m}>
                                <span
                                  className={`history-heat heat-cell ${n === null ? "unknown" : n === 0 ? "zero" : "heat-" + (scale.find((s) => n <= s.high)?.level ?? 5)}`}
                                  title={`${sensor} ${year} ${m}: ${n === null ? "unknown or excluded" : n.toLocaleString() + " loaded detections"}; ${status ? availabilityText(status) : "outside study"}`}
                                >
                                  {n === null ? "—" : n.toLocaleString()}
                                  {n !== null &&
                                  status === "partial-record-interval"
                                    ? "*"
                                    : ""}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="inline-note">
                Color uses one linear count scale, 0–{countMax.toLocaleString()}
                , across both instruments. Counts are not equivalent measures of
                fire activity.
              </p>
              <div
                className="history-chart"
                role="img"
                aria-label="Separate MODIS and VIIRS aggregate monthly histories; exact values in calendar above"
              >
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={focused}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" />
                    <YAxis width={56} />
                    <Tooltip />
                    <Line
                      dataKey="MODIS"
                      stroke="#b54c20"
                      dot={focused.length === 1}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="VIIRS"
                      stroke="#2d7191"
                      dot={focused.length === 1}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
        <details>
          <summary>Processing quality and source provenance</summary>
          <p>
            Version <code>{manifest.version}</code> ·{" "}
            {manifest.extent.count.toLocaleString()} retained records ·{" "}
            {manifest.extent.start} to {manifest.extent.end}. No harmonization
            or coverage correction applied.
          </p>
          {manifest.sources.map((s) => (
            <div key={s.id}>
              <p>
                <strong>{s.path}</strong>
                <br />
                {s.accepted.toLocaleString()} accepted · {s.rejected} rejected ·{" "}
                {s.duplicates} duplicates · {s.conflicts} conflicting duplicate
                payloads.
                <br />
                SHA-256 <code className="source-hash">{s.sha256}</code>
              </p>
              <p>
                Source versions:{" "}
                {s.sourceAttributes
                  .map(
                    (d) =>
                      `${d.instrument || "inferred instrument"} ${d.satellite || "unspecified platform"}: ${d.version} (${d.rows.toLocaleString()} valid source rows, including ${d.duplicates} duplicates)`,
                  )
                  .join("; ")}
                . Missing supplied attributes: {JSON.stringify(s.missing)}.
                Invalid optional attributes: {JSON.stringify(s.invalid)}.
              </p>
            </div>
          ))}
          <p>
            {manifest.coverage} {manifest.spatial}
          </p>
        </details>
      </section>
    </>
  );
}
