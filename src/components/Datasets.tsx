import { Trash2, Database, ExternalLink } from "lucide-react";
import { useStudy } from "../state/StudyContext";
export function Datasets({ remove }: { remove: (id: string) => void }) {
  const { datasets } = useStudy();
  return (
    <section className="dataset-view">
      <div className="section-heading">
        <div>
          <h2>Loaded datasets</h2>
          <p>Original sensor streams, with traceable source metadata.</p>
        </div>
        <Database size={21} />
      </div>
      {!datasets.length && (
        <div className="empty-state">
          <h3>No datasets loaded</h3>
          <p>Use Import data to add official NASA FIRMS CSV files.</p>
        </div>
      )}
      {datasets.map((d) => (
        <article className="dataset-entry" key={d.id}>
          <div className="section-heading">
            <div>
              <h3>{d.name}</h3>
              <p>
                {d.sensors.join(", ")} · {d.satellites.join(", ")} · source
                version {d.versions.join(", ")}
              </p>
            </div>
            <button
              className="button small danger"
              onClick={() => remove(d.id)}
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
          <dl className="dataset-facts">
            <div>
              <dt>Loaded observations</dt>
              <dd>{d.records.length.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Record date extent (UTC)</dt>
              <dd>
                {d.start} to {d.end}
              </dd>
            </div>
            <div>
              <dt>Rejected rows</dt>
              <dd>{d.rejected}</dd>
            </div>
            <div>
              <dt>Duplicates skipped</dt>
              <dd>{d.duplicates}</dd>
            </div>
          </dl>
          <details>
            <summary>Provenance and validation details</summary>
            <dl className="provenance-list">
              <div>
                <dt>Source</dt>
                <dd>
                  {d.source.startsWith("https://") ? (
                    <a href={d.source} target="_blank" rel="noreferrer">
                      {d.source}
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    d.source
                  )}
                </dd>
              </div>
              <div>
                <dt>Imported at (UTC)</dt>
                <dd>{d.importedAt}</dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd className="hash">{d.hash}</dd>
              </div>
              <div>
                <dt>Coverage</dt>
                <dd>
                  Record extent only. Observation coverage is not established.
                </dd>
              </div>
            </dl>
            {d.warnings.length ? (
              <ul className="validation-warnings">
                {d.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : (
              <p>
                No validation warnings. Coordinates, acquisition dates, and
                instrument identities validated.
              </p>
            )}
          </details>
        </article>
      ))}
      <p className="session-note">
        Imports are local to this session. Reload restores the bundled
        historical archives; retain your originals. Removal does not delete
        source files.
      </p>
    </section>
  );
}
