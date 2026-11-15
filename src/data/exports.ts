import Papa from "papaparse";
import { filterRecords } from "./analytics";
import type { Dataset, Filters, Observation } from "./types";
import {
  activityRows,
  availabilityText,
  recordWindows,
  studyDates,
  type DateWindow,
} from "./research";
export const limitations =
  "Raw detection records, not unique fires, burned area, or a harmonized index. Record dates do not establish satellite observation coverage. All source type codes included.";
export function studyMetadata(
  datasets: Dataset[],
  filters: Filters,
  extent: DateWindow,
) {
  return {
    application: "FireLens",
    schemaVersion: 1,
    generatedAtUTC: new Date().toISOString(),
    filters,
    effectiveDatesUTC: studyDates(filters, extent),
    limitations,
    datasets: datasets.map(
      ({
        id,
        name,
        source,
        hash,
        sensors,
        satellites,
        versions,
        start,
        end,
        records,
        rejected,
        duplicates,
      }) => ({
        id,
        name,
        source,
        sha256: hash,
        sensors,
        satellites,
        versions,
        recordStartUTC: start,
        recordEndUTC: end,
        records: records.length,
        rejected,
        duplicates,
      }),
    ),
  };
}
const unparse = (rows: Record<string, unknown>[]) =>
  "\uFEFF" + Papa.unparse(rows, { escapeFormulae: true, newline: "\r\n" });
export function observationsCSV(
  records: Observation[],
  datasets: Dataset[],
  filters: Filters,
  extent: DateWindow,
) {
  const sources = new Map(datasets.map((d) => [d.id, d]));
  const metadata = studyMetadata(datasets, filters, extent);
  return unparse(
    filterRecords(records, filters).map((r) => ({
      latitude: r.latitude,
      longitude: r.longitude,
      acq_date_utc: r.date,
      acq_time_utc: r.time,
      sensor: r.sensor,
      platform: r.satellite,
      source_instrument: r.sourceInstrument,
      source_satellite: r.sourceSatellite,
      confidence_source_value: r.confidence,
      frp_mw: r.frp ?? "",
      source_version: r.version,
      daynight: r.daynight,
      ...Object.fromEntries(
        [
          "brightness",
          "bright_t31",
          "bright_ti4",
          "bright_ti5",
          "scan",
          "track",
          "type",
        ].map((k) => [k, r.thermal[k] ?? ""]),
      ),
      dataset_name: sources.get(r.datasetId)?.name ?? "",
      dataset_sha256: sources.get(r.datasetId)?.hash ?? "",
      source: sources.get(r.datasetId)?.source ?? "",
      study_filters: JSON.stringify(filters),
      study_dates_utc: JSON.stringify(metadata.effectiveDatesUTC),
      generated_at_utc: metadata.generatedAtUTC,
      limitations,
    })),
  );
}
export function monthlyCSV(
  records: Observation[],
  datasets: Dataset[],
  filters: Filters,
  extent: DateWindow,
) {
  const metadata = studyMetadata(datasets, filters, extent);
  if (
    !metadata.effectiveDatesUTC.start ||
    !metadata.effectiveDatesUTC.end ||
    metadata.effectiveDatesUTC.start > metadata.effectiveDatesUTC.end
  )
    throw new Error("No valid monthly interval. Check the study date range.");
  return unparse(
    activityRows(
      filterRecords(records, filters),
      metadata.effectiveDatesUTC,
      recordWindows(datasets),
      filters.sensor,
    ).map((r) => ({
      year: r.period.slice(0, 4),
      month: r.period.slice(5, 7),
      MODIS_count: r.MODIS ?? "",
      VIIRS_count: r.VIIRS ?? "",
      MODIS_status:
        filters.sensor === "VIIRS"
          ? "Excluded by sensor filter"
          : availabilityText(r.MODIS_status),
      VIIRS_status:
        filters.sensor === "MODIS"
          ? "Excluded by sensor filter"
          : availabilityText(r.VIIRS_status),
      study_filters: JSON.stringify(filters),
      study_dates_utc: JSON.stringify(metadata.effectiveDatesUTC),
      sources: JSON.stringify(metadata.datasets),
      generated_at_utc: metadata.generatedAtUTC,
      limitations,
    })),
  );
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
