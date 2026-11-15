import { useState } from "react";
import { Download, X } from "lucide-react";
import { useStudy } from "../state/StudyContext";
import {
  download,
  monthlyCSV,
  observationsCSV,
  studyMetadata,
} from "../data/exports";
import { calendarImage } from "../data/calendarImage";
export function ExportPanel({ onClose }: { onClose: () => void }) {
  const { focused, datasets, filters, extent, calendarSensor } = useStudy();
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [imageSensor, setImageSensor] = useState<"MODIS" | "VIIRS">(calendarSensor);
  const sensor = filters.sensor === "all" ? imageSensor : filters.sensor;
  async function run(kind: "observations" | "monthly" | "png" | "metadata") {
    setBusy(true);
    setStatus("Preparing export…");
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const suffix =
        (filters.month ||
          [filters.start || extent.start, filters.end || extent.end].join(
            "_",
          )) +
        "_" +
        filters.sensor;
      if (kind === "png")
        download(
          await calendarImage(focused, datasets, filters, extent, sensor),
          "firelens_calendar_" + suffix + "_" + sensor + ".png",
        );
      else if (kind === "metadata")
        download(
          new Blob(
            [JSON.stringify(studyMetadata(datasets, filters, extent), null, 2)],
            { type: "application/json" },
          ),
          "firelens_provenance_" + suffix + ".json",
        );
      else
        download(
          new Blob(
            [
              kind === "observations"
                ? observationsCSV(focused, datasets, filters, extent)
                : monthlyCSV(focused, datasets, filters, extent),
            ],
            { type: "text/csv;charset=utf-8" },
          ),
          "firelens_" + kind + "_" + suffix + ".csv",
        );
      setStatus("Export prepared. Your browser handles the download.");
    } catch (e) {
      setStatus("Export failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="export-panel" aria-labelledby="export-heading">
      <div className="section-heading">
        <div>
          <h2 id="export-heading">Export current study</h2>
          <p>
            {focused.length.toLocaleString()} matching records · current region,
            dates, sensor, and selected month
          </p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close export panel"
        >
          <X size={18} />
        </button>
      </div>
      <div className="export-actions">
        <button
          className="button"
          disabled={busy || !focused.length}
          onClick={() => void run("observations")}
        >
          <Download size={15} />
          Observations CSV
        </button>
        <button
          className="button"
          disabled={busy || !datasets.length}
          onClick={() => void run("monthly")}
        >
          Monthly summary CSV
        </button>
        <label>
          PNG instrument
          <select
            value={sensor}
            disabled={filters.sensor !== "all"}
            onChange={(e) =>
              setImageSensor(e.target.value as typeof imageSensor)
            }
          >
            <option>MODIS</option>
            <option>VIIRS</option>
          </select>
        </label>
        <button
          className="button"
          disabled={busy || !datasets.some((d) => d.sensors.includes(sensor))}
          onClick={() => void run("png")}
        >
          Calendar PNG
        </button>
        <button
          className="text-button"
          disabled={busy || !datasets.length}
          onClick={() => void run("metadata")}
        >
          Provenance JSON
        </button>
      </div>
      <p className="export-note">
        CSV files include filter and source metadata. Blank summary counts mean
        unavailable or excluded, never an assumed zero. PNG uses the current
        focused scope. Raw observations are not harmonized.
      </p>
      <p role="status" className="progress-message">
        {status}
      </p>
    </section>
  );
}
