import { buildBins, filterRecords } from "./analytics";
import type { Dataset, Filters, Observation, Sensor } from "./types";
export const sensors = ["MODIS", "VIIRS"] as const;
export type DateWindow = { start: string; end: string };
export type SensorWindows = Record<Sensor, DateWindow[]>;
export type Availability =
  | "not-loaded"
  | "outside-study"
  | "outside-record-extent"
  | "partial-record-interval"
  | "within-record-interval";
export const monthEnd = (period: string) =>
  `${period}-${String(new Date(Date.UTC(+period.slice(0, 4), +period.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}`;
export function recordWindows(datasets: Dataset[]): SensorWindows {
  const result: SensorWindows = { MODIS: [], VIIRS: [] };
  for (const dataset of datasets)
    for (const sensor of sensors) {
      let start = "",
        end = "";
      for (const r of dataset.records)
        if (r.sensor === sensor) {
          if (!start || r.date < start) start = r.date;
          if (!end || r.date > end) end = r.date;
        }
      if (start) result[sensor].push({ start, end });
    }
  return result;
}
export function studyDates(
  filters: Filters,
  extent: DateWindow,
  includeMonth = true,
): DateWindow {
  let start = filters.start || extent.start,
    end = filters.end || extent.end;
  if (includeMonth && filters.month) {
    start = [start, `${filters.month}-01`].filter(Boolean).sort().at(-1)!;
    end = [end, monthEnd(filters.month)].filter(Boolean).sort()[0];
  }
  return { start, end };
}
export function periodAvailability(
  period: string,
  scope: DateWindow,
  windows: DateWindow[],
): Availability {
  const start = period.length === 4 ? `${period}-01-01` : `${period}-01`;
  const end = period.length === 4 ? `${period}-12-31` : monthEnd(period);
  if (
    !scope.start ||
    !scope.end ||
    scope.start > scope.end ||
    end < scope.start ||
    start > scope.end
  )
    return "outside-study";
  if (!windows.length) return "not-loaded";
  const from = start > scope.start ? start : scope.start,
    to = end < scope.end ? end : scope.end;
  const intersections = windows
    .filter((w) => w.end >= from && w.start <= to)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!intersections.length) return "outside-record-extent";
  // Intervals describe retained record dates, never confirmed satellite coverage.
  let through = "";
  let gap = false;
  for (const w of intersections) {
    const next = through
      ? new Date(Date.parse(through + "T00:00:00Z") + 86400000)
          .toISOString()
          .slice(0, 10)
      : from;
    if (w.start > next) gap = true;
    if (w.end > through) through = w.end;
  }
  return from > start || to < end || gap || through < to
    ? "partial-record-interval"
    : "within-record-interval";
}
export const availabilityText = (status: Availability) =>
  ({
    "not-loaded": "Instrument not loaded",
    "outside-study": "Outside study dates",
    "outside-record-extent": "Unknown / outside record extent",
    "partial-record-interval": "Partial record/date interval; coverage unknown",
    "within-record-interval": "Within record-date interval; coverage unknown",
  })[status];
export type ActivityRow = {
  period: string;
  MODIS: number | null;
  VIIRS: number | null;
  MODIS_status: Availability;
  VIIRS_status: Availability;
};
export function activityRows(
  records: Observation[],
  scope: DateWindow,
  windows: SensorWindows,
  sensor: "all" | Sensor = "all",
  unit: "month" | "year" = "month",
): ActivityRow[] {
  return buildBins(records, scope.start, scope.end, unit).map((bin) => {
    const MODIS_status = periodAvailability(bin.period, scope, windows.MODIS),
      VIIRS_status = periodAvailability(bin.period, scope, windows.VIIRS);
    const available = (s: Sensor, status: Availability) =>
      (sensor === "all" || sensor === s) &&
      ["partial-record-interval", "within-record-interval"].includes(status)
        ? bin[s]
        : null;
    return {
      period: bin.period,
      MODIS: available("MODIS", MODIS_status),
      VIIRS: available("VIIRS", VIIRS_status),
      MODIS_status,
      VIIRS_status,
    };
  });
}
export function countScale(max: number) {
  const top = Math.max(1, max);
  return Array.from({ length: Math.min(5, top) }, (_, i) => ({
    level: i + 1,
    low: Math.floor((i * top) / Math.min(5, top)) + 1,
    high: Math.floor(((i + 1) * top) / Math.min(5, top)),
  }));
}
export function comparisonData(
  records: Observation[],
  filters: Filters,
  windows: SensorWindows,
  extent: DateWindow,
) {
  const scope = studyDates(filters, extent);
  const ranges = sensors.map((s) =>
    windows[s].length
      ? {
          start: windows[s].map((w) => w.start).sort()[0],
          end: windows[s]
            .map((w) => w.end)
            .sort()
            .at(-1)!,
        }
      : null,
  );
  const start = ranges.every(Boolean)
    ? [scope.start, ranges[0]!.start, ranges[1]!.start].sort().at(-1)!
    : "";
  const end = ranges.every(Boolean)
    ? [scope.end, ranges[0]!.end, ranges[1]!.end].sort()[0]
    : "";
  if (!start || start > end)
    return {
      start: "",
      end: "",
      rows: [] as ActivityRow[],
      records: [] as Observation[],
    };
  const overlap: DateWindow[] = [];
  for (const m of windows.MODIS)
    for (const v of windows.VIIRS) {
      const a = [start, m.start, v.start].sort().at(-1)!,
        b = [end, m.end, v.end].sort()[0];
      if (a <= b) overlap.push({ start: a, end: b });
    }
  if (!overlap.length)
    return {
      start: "",
      end: "",
      rows: [] as ActivityRow[],
      records: [] as Observation[],
    };
  const selected = filterRecords(records, { ...filters, start, end }).filter(
    (r) => overlap.some((w) => r.date >= w.start && r.date <= w.end),
  );
  const rows = activityRows(
    selected,
    { start, end },
    { MODIS: overlap, VIIRS: overlap },
    filters.sensor,
  );
  // Require both record streams to have a supported interval in each paired month.
  return { start, end, rows, records: selected };
}
