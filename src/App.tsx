import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Upload,
  Focus,
  ArrowUpRight,
  X,
  Database,
  Download,
} from "lucide-react";
import { useStudy } from "./state/StudyContext";
import { browserRepository, addDataset } from "./data/repository";
import type { Dataset } from "./data/types";
import { ImportPanel } from "./components/ImportPanel";
import { StudyControls } from "./components/StudyControls";
import { Calendar } from "./components/Calendar";
import { SensorComparison } from "./components/SensorComparison";
import { Datasets } from "./components/Datasets";
import { Methods } from "./components/Methods";
import { loadDemoFile, type DemoManifest } from "./data/demo";
import { ExportPanel } from "./components/ExportPanel";
import { ActivitySummary } from "./components/ActivitySummary";
import { FireCalendar } from "./fire/FireCalendar";
type View = "calendar" | "workspace" | "datasets" | "methods";
const viewFromHash = (): View => {
  const h = window.location.hash.slice(1);
  return h === "workspace" || h === "datasets" || h === "methods" ? h : "calendar";
};
const FireMap = lazy(() =>
  import("./components/FireMap").then((m) => ({ default: m.FireMap })),
);
const Timeline = lazy(() =>
  import("./components/Timeline").then((m) => ({ default: m.Timeline })),
);
export default function App() {
  const { datasets, setDatasets, filters } = useStudy();
  const datasetRef = useRef<Dataset[]>([]);
  const started = useRef(false);
  const [view, setViewState] = useState<View>(viewFromHash);
  const setView = (v: View) => {
    setViewState(v);
    const url = `${window.location.pathname}${window.location.search}${v === "calendar" ? "" : "#" + v}`;
    window.history.replaceState(null, "", url);
  };
  useEffect(() => {
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [share, setShare] = useState(50);
  const importRegion = useRef<HTMLDivElement>(null);
  async function importFiles(
    files: File[],
    source = "User-supplied FIRMS CSV (origin not authenticated)",
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const messages: string[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        setProgress(`Reading ${file.name}…`);
        const result = await browserRepository.importFile(file, source, (n) =>
          setProgress(`${file.name} · ${n.toLocaleString()} rows validated`),
        );
        const added = addDataset(datasetRef.current, result);
        datasetRef.current = added.datasets;
        setDatasets(added.datasets);
        messages.push(added.message);
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    setNotice(messages.join(" "));
    setError(errors.join(" "));
    setProgress("");
    busyRef.current = false;
    setBusy(false);
  }
  useEffect(() => {
    // The v1 CSV demo is only needed by the CSV workspace views.
    if (view === "calendar" || started.current) return;
    started.current = true;
    void (async () => {
      busyRef.current = true;
      setBusy(true);
      const problems: string[] = [];
      try {
        const response = await fetch("/data/demo/v1/manifest.json");
        if (!response.ok)
          throw new Error(
            "Bundled archive manifest unavailable. Import your original FIRMS CSV files to continue.",
          );
        const manifest = (await response.json()) as DemoManifest;
        if (!Array.isArray(manifest.files) || !manifest.files.length)
          throw new Error(
            "The versioned demonstration bundle has no datasets. Import original FIRMS CSVs to continue.",
          );
        for (const item of manifest.files) {
          try {
            setProgress(`Loading historical archive · ${item.name}`);
            const file = await loadDemoFile(item);
            const result = await browserRepository.importFile(
              file,
              item.source,
              (n) =>
                setProgress(
                  `${item.name} · ${n.toLocaleString()} rows validated`,
                ),
            );
            if (result.hash !== item.hash)
              throw new Error(
                `${item.name}: checksum differs from the inspected original. Import the original file or regenerate the manifest.`,
              );
            if (
              result.records.length !== item.records ||
              result.rejected ||
              result.duplicates
            )
              throw new Error(
                `${item.name}: validated record count differs from the versioned manifest.`,
              );
            const added = addDataset(datasetRef.current, result);
            datasetRef.current = added.datasets;
            setDatasets(added.datasets);
          } catch (e) {
            problems.push((e as Error).message);
          }
        }
      } catch (e) {
        problems.push((e as Error).message);
      } finally {
        setError(problems.join(" "));
        setProgress("");
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [setDatasets, view]);
  useEffect(() => {
    if (importOpen)
      importRegion.current?.scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
  }, [importOpen]);
  function remove(id: string) {
    const next = datasetRef.current.filter((d) => d.id !== id);
    datasetRef.current = next;
    setDatasets(next);
    setNotice(
      "Dataset removed from this session. Original files are unchanged.",
    );
  }
  const title =
    view === "calendar"
      ? "Harmonized fire calendar"
      : view === "workspace"
      ? "Research workspace"
      : view === "datasets"
        ? "Datasets"
        : "Methods & provenance";
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // The hash selects the view, so move focus without changing it.
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to main content
      </a>
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("calendar");
          }}
          aria-label="FireLens fire calendar"
        >
          <Focus size={25} />
          <span>FireLens</span>
        </a>
        <nav aria-label="Primary">
          {(["calendar", "workspace", "datasets", "methods"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-current={view === v ? "page" : undefined}
            >
              {v === "methods"
                ? "Methods & provenance"
                : v === "calendar"
                  ? "Fire calendar"
                  : v === "workspace"
                    ? "CSV workspace"
                    : "Datasets"}
            </button>
          ))}
        </nav>
        <span className="header-purpose">NASA FIRMS fire record, 2000 to today</span>
        <div className="header-actions" hidden={view === "calendar"}>
          <button
            className="button header-import"
            aria-label="Export results"
            disabled={busy || !datasets.length}
            onClick={() => {
              setExportOpen((v) => !v);
              setImportOpen(false);
            }}
          >
            <Download size={15} />
            Export
          </button>
          <button
            className="button header-import"
            onClick={() => {
              setImportOpen(true);
              setExportOpen(false);
            }}
            disabled={busy}
          >
            <Upload size={15} />
            Import data
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="workspace-heading">
          <div>
            <h1>{title}</h1>
            <p>
              {view === "calendar"
                ? "MODIS + VIIRS burning activity since November 2000, on one harmonized scale."
                : view === "workspace"
                ? "Load FIRMS point records and compare MODIS and VIIRS month by month."
                : view === "datasets"
                  ? "Every loaded file, with its source, version and date range."
                  : "What these observations can tell you, and where they stop."}
            </p>
          </div>
          <div className="dataset-status" hidden={view === "calendar"}>
            <span className={busy ? "status-dot loading" : "status-dot"} />
            {busy
              ? "Validating observations"
              : `${datasets.length} ${datasets.length === 1 ? "dataset" : "datasets"} loaded`}
            <span className="raw-label">Raw observations</span>
          </div>
        </div>
        {importOpen && (
          <div ref={importRegion}>
            <ImportPanel
              busy={busy}
              onImport={importFiles}
              onClose={() => setImportOpen(false)}
              progress={progress}
            />
          </div>
        )}
        {exportOpen && <ExportPanel onClose={() => setExportOpen(false)} />}
        {busy && (
          <div className="loading-strip" role="status">
            <Database size={16} />
            {progress || "Preparing data…"}
          </div>
        )}
        {error && (
          <div className="feedback error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="feedback" role="status">
            <span>{notice}</span>
            <button
              className="icon-button"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {view === "calendar" ? (
          <FireCalendar />
        ) : view === "workspace" ? (
          <>
            <StudyControls />
            <ActivitySummary />
            <div className="workspace-context">
              <span>
                <i className="sensor-dot modis" />
                MODIS{" "}
                {datasets.some((d) => d.sensors.includes("MODIS"))
                  ? "loaded"
                  : "not loaded"}
                <span className="context-divider" />
                <i className="sensor-dot viirs" />
                VIIRS{" "}
                {datasets.some((d) => d.sensors.includes("VIIRS"))
                  ? "loaded"
                  : "not loaded"}
              </span>
              <label className="layout-control">
                Map / calendar
                <input
                  type="range"
                  min="40"
                  max="60"
                  value={share}
                  onChange={(e) => setShare(+e.target.value)}
                  aria-label="Map width percentage"
                />
              </label>
            </div>
            <div
              className="primary-workspace"
              style={{
                gridTemplateColumns: `minmax(0, ${share}fr) minmax(0, ${100 - share}fr)`,
              }}
            >
              <Suspense
                fallback={
                  <div className="panel-loading">
                    Preparing geographic workspace…
                  </div>
                }
              >
                <FireMap />
              </Suspense>
              <Calendar />
            </div>
            <div className="analytics-workspace">
              <Suspense
                fallback={
                  <div className="panel-loading">
                    Preparing detection history…
                  </div>
                }
              >
                <Timeline />
              </Suspense>
              <SensorComparison />
            </div>
            <div className="provenance-strip">
              <div>
                <Database size={16} />
                <span>
                  NASA FIRMS ·{" "}
                  {datasets.length
                    ? datasets
                        .map(
                          (d) =>
                            `${d.sensors.join("/")} ${d.satellites.join("/")} · v${d.versions.join("/")}`,
                        )
                        .join(" / ")
                    : "No records loaded"}
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => setView("datasets")}
              >
                Inspect sources <ArrowUpRight size={14} />
              </button>
            </div>
            {filters.month && (
              <p className="mobile-focus-note">
                Focus: {filters.month}. Clear the selected month in the study
                controls to restore the full map.
              </p>
            )}
          </>
        ) : view === "datasets" ? (
          <Datasets remove={remove} />
        ) : (
          <Methods />
        )}
      </main>
      <footer className="app-footer">
        <span>FireLens · NASA FIRMS observation explorer</span>
        <span>
          {view === "calendar"
            ? "Harmonized calendar: method fcd-harmonize-v2, validated by held-out years (see docs)"
            : "CSV workspace: raw sensors, no harmonization applied"}
        </span>
      </footer>
    </>
  );
}
