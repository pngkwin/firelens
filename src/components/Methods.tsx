import { ExternalLink } from "lucide-react";
import { useStudy } from "../state/StudyContext";
import { HistoricalResearch } from "./HistoricalResearch";
export function Methods() {
  const { datasets } = useStudy();
  return (
    <article className="methods-view">
      <h2>Reading the observation record</h2>
      <p className="lead">
        FireLens makes satellite observations easier to explore. Scientific
        harmonization remains a separate, future method to develop and validate.
      </p>
      <div className="methods-grid">
        <section>
          <h3>One source, distinct instruments</h3>
          <p>
            NASA FIRMS distributes active-fire and thermal-anomaly detections.
            MODIS Terra and Aqua observations have nominal 1 km resolution;
            VIIRS active-fire observations have nominal 375 m resolution.
            Instrument characteristics and observation opportunities differ. Raw
            counts are not directly equivalent.
          </p>
          <p>
            MODIS numerical confidence and VIIRS low / nominal / high confidence
            remain in their original source form. FireLens applies no shared
            confidence threshold.
          </p>
        </section>
        <section>
          <h3>What the calendar measures</h3>
          <p>
            Each cell counts loaded detection records for one instrument,
            region, and month. Multiple records can describe the same event.
            Hotspot counts are neither individual fires nor burned area.
          </p>
          <p>
            A zero means no matching records in the loaded data. Missing
            hotspots do not establish that an area was observed or that no fire
            occurred. Months outside loaded record extent appear as unknown.
          </p>
        </section>
        <section>
          <h3>Consistent time and space</h3>
          <p>
            Acquisition dates and HHMM times are parsed in UTC. Region bounds,
            date ranges, and sensor selection are shared across all views.
            Panning the map never changes the study region. Selecting a month
            focuses records without erasing the historical calendar context.
          </p>
          <p>
            Duplicates are identified by instrument, satellite, acquisition
            timestamp, latitude, and longitude. The first imported observation
            wins, including across versions; revised products are not silently
            added twice.
          </p>
        </section>
        <section>
          <h3>Provenance and limits</h3>
          <p>
            Bundled archives retain their original CSV bytes and SHA-256
            checksums. User-imported files are validated structurally; the app
            cannot authenticate their origin. Source version and thermal column
            names are retained rather than guessed or converted.
          </p>
          <p>
            No validated harmonized index, coverage correction,
            uncertainty score, or prediction is implemented. Historical baseline utilities require eligible multi-year data. Browser CSV processing
            is limited to 25 MB per file and 100,000 retained observations per
            workspace.
          </p>
        </section>
      </div>
      <HistoricalResearch />
      <section className="methods-sources">
        <h3>Current satellite record</h3>
        {datasets.length ? (
          datasets.map((d) => (
            <p key={d.id}>
              <strong>
                {d.sensors.join(", ")} · {d.satellites.join(", ")}
              </strong>{" "}
              — {d.records.length.toLocaleString()} records, {d.start} to{" "}
              {d.end}, version {d.versions.join(", ")}.
            </p>
          ))
        ) : (
          <p>No satellite observations loaded.</p>
        )}
        <h3>Official documentation</h3>
        <ul>
          <li>
            <a
              href="https://firms.modaps.eosdis.nasa.gov/download/"
              target="_blank"
              rel="noreferrer"
            >
              NASA FIRMS archive downloads <ExternalLink size={13} />
            </a>
          </li>
          <li>
            <a
              href="https://firms.modaps.eosdis.nasa.gov/content/active_fire/"
              target="_blank"
              rel="noreferrer"
            >
              Active-fire products and data access <ExternalLink size={13} />
            </a>
          </li>
          <li>
            <a
              href="https://firms.modaps.eosdis.nasa.gov/content/academy/data_ingest/firms_data_ingest.html"
              target="_blank"
              rel="noreferrer"
            >
              FIRMS Fire Data Academy: interpreting CSV attributes{" "}
              <ExternalLink size={13} />
            </a>
          </li>
        </ul>
      </section>
    </article>
  );
}
