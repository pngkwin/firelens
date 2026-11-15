import { useRef, useState, type ChangeEvent } from "react";
import { Upload, X, FileUp, ExternalLink } from "lucide-react";
export function ImportPanel({
  busy,
  onImport,
  onClose,
  progress,
}: {
  busy: boolean;
  onImport: (files: File[]) => Promise<void>;
  onClose: () => void;
  progress: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void onImport(Array.from(event.target.files));
    event.target.value = "";
  };
  return (
    <section className="import-panel" aria-labelledby="import-heading">
      <div className="section-heading">
        <div>
          <h2 id="import-heading">Import NASA FIRMS data</h2>
          <p>Bring your region and history into the workspace.</p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close import panel"
        >
          <X size={18} />
        </button>
      </div>
      <div
        className={`drop-zone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) void onImport(Array.from(e.dataTransfer.files));
        }}
      >
        <FileUp size={28} />
        <div>
          <strong>Drop your FIRMS CSV files here</strong>
          <p>MODIS Collection 6.1 or VIIRS 375 m · multiple files supported</p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} /> Choose CSV files
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={pick}
          className="sr-only"
          aria-label="Import FIRMS CSV files"
          disabled={busy}
        />
      </div>
      <div className="import-foot">
        <p>
          25 MB per file · 100,000 observations per workspace · processed
          locally in a worker. Imports last for this browser session; reload
          restores the bundled archive.
        </p>
        <a
          href="https://firms.modaps.eosdis.nasa.gov/download/"
          target="_blank"
          rel="noreferrer"
        >
          Get official data <ExternalLink size={13} />
        </a>
      </div>
      <p role="status" className="progress-message">
        {progress}
      </p>
    </section>
  );
}
