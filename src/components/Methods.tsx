import { ExternalLink } from "lucide-react";
import { useStudy } from "../state/StudyContext";
import { HistoricalResearch } from "./HistoricalResearch";
export function Methods() {
  const { datasets } = useStudy();
  return (
    <article className="methods-view">
      <h2>Reading the observation record</h2>
      <p className="lead">
        FireLens has two views. The Fire calendar shows one harmonized,
        MODIS-equivalent record of burning activity from November 2000 to the
        latest day (method fcd-harmonize-v3), with the raw sensor records next
        to it. The CSV workspace below keeps individual 2024 sample records per
        instrument and applies no harmonization.
      </p>
      <div className="methods-grid">
        <section>
          <h3>One source, distinct instruments</h3>
          <p>
            NASA FIRMS distributes active-fire and thermal-anomaly detections.
            MODIS Terra and Aqua observations have nominal 1 km resolution;
            VIIRS active-fire observations have nominal 375 m resolution and
            detect smaller and cooler fires. Overpass times and observation
            opportunities differ. Raw counts are not directly equivalent and are
            never added across sensors.
          </p>
          <p>
            MODIS numerical confidence and VIIRS low / nominal / high confidence
            remain in their original source form. FireLens applies no shared
            confidence threshold.
          </p>
        </section>
        <section>
          <h3>How the calendar harmonizes</h3>
          <p>
            Common grid: every detection is mapped to an H3 cell of about
            0.74 km² on its UTC day, and a cell-day counts once however many
            satellites or pixels saw it (a union, never a sum). This removes
            most of the pixel-count difference between 375 m and 1 km pixels,
            but not VIIRS’s higher sensitivity.
          </p>
          <p>
            Cross-calibration: 2002-07 to 2021 is observed MODIS (Terra ∪ Aqua).
            From 2022 MODIS orbits drift, so MODIS-equivalent values are
            estimated from one VIIRS satellite per month, cross-calibrated to
            S-NPP, with ratios fitted by zone, month and day/night (US) or
            quantile mapping (Iberia) on 2012–2021, when both sensors were
            stable. Before Aqua (2000-11 to 2002-06), Terra is scaled to
            Terra ∪ Aqua. Estimated months carry 90% intervals from held-out
            years.
          </p>
        </section>
        <section>
          <h3>Observation coverage</h3>
          <p>
            Zero detections are never taken as proof of an outage. A
            satellite-day is flagged only when another satellite observing the
            same day saw enough fire that this one should have recorded it too
            (or, for Terra alone in 2000–2002, when the same days in every other
            year make zero detections implausible). Flagged runs that match a
            NASA/NOAA notice are confirmed; the others are suspected.
          </p>
          <p>
            The VIIRS reference skips a satellite with flagged days (for
            example NOAA-20 replaces S-NPP in July 2024). Months whose source
            lost at least 5% of its expected detections are marked as reduced
            coverage, have no anomaly statistics and are left out of baselines
            and trends. Days before a sensor was in orbit have no value, not
            zero.
          </p>
        </section>
        <section>
          <h3>What the validation shows, and what it does not</h3>
          <p>
            Each year of 2012–2021 is predicted from a model refitted on the
            other years (every parameter, including cross-calibration factors),
            and compared with the MODIS that was actually observed. This tests
            reproducibility of the MODIS scale from VIIRS, not agreement with
            fires on the ground. The per-region method choice was written down
            after an earlier Iberia result had been seen, so it is not
            pre-registered; a nested score that repeats the choice inside each
            held-out year is reported alongside.
          </p>
          <p>
            Known limits: intervals for areas smaller than a region covered only
            about 76–83% of held-out US zones until their sampling term was
            widened by a factor chosen out-of-sample (now about 90%); areas much
            smaller than a zone are not validated; cloud, smoke
            and overpass opportunity are not modelled; in the US, observed near-real-time MODIS for September–November
            2026 is 22–39% below the VIIRS-based estimate (Iberia does not show
            this), for reasons not yet explained (orbit drift or near-real-time
            processing). Full numbers: docs/harmonization-validation.md.
          </p>
        </section>
        <section>
          <h3>What the CSV workspace shows</h3>
          <p>
            Each cell counts loaded detection records for one instrument,
            region, and month. Multiple records can describe the same event.
            Hotspot counts are neither individual fires nor burned area. A zero
            means no matching records in the loaded data; months outside the
            loaded record appear as unknown.
          </p>
          <p>
            Acquisition dates and HHMM times are parsed in UTC. Duplicates are
            identified by instrument, satellite, acquisition timestamp,
            latitude, and longitude; the first imported observation wins, so
            revised products are not added twice.
          </p>
        </section>
        <section>
          <h3>Provenance and limits</h3>
          <p>
            Calendar bundles and calibration files are verified against SHA-256
            hashes before use, and every export carries the method version,
            file hashes and the satellite outages that affect it. Bundled
            workspace archives retain their original CSV bytes; user-imported
            files are validated structurally, but the app cannot authenticate
            their origin.
          </p>
          <p>
            The workspace applies no harmonization, coverage correction or
            uncertainty estimate to its raw records. Browser CSV processing is
            limited to 25 MB per file and 100,000 retained observations per
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
