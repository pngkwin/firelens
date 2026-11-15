import type { Bounds, Dataset, Filters, Observation, Sensor } from "./types";
export const inBounds = (record: Pick<Observation, "latitude" | "longitude">, bounds: Bounds) =>
  record.latitude >= bounds.south &&
  record.latitude <= bounds.north &&
  (bounds.west <= bounds.east
    ? record.longitude >= bounds.west && record.longitude <= bounds.east
    : record.longitude >= bounds.west || record.longitude <= bounds.east);
export function filterRecords(
  records: Observation[],
  filters: Filters,
  includeMonth = true,
) {
  return records.filter(
    (r) =>
      (!filters.start || r.date >= filters.start) &&
      (!filters.end || r.date <= filters.end) &&
      (filters.sensor === "all" || r.sensor === filters.sensor) &&
      (!filters.bounds || inBounds(r, filters.bounds)) &&
      (!includeMonth || !filters.month || r.date.startsWith(filters.month)),
  );
}
export interface TimeBin {
  period: string;
  MODIS: number;
  VIIRS: number;
}
export function aggregate(
  records: Observation[],
  unit: "month" | "year" = "month",
): TimeBin[] {
  const bins = new Map<string, TimeBin>();
  for (const record of records) {
    const period = record.date.slice(0, unit === "month" ? 7 : 4);
    const bin = bins.get(period) ?? { period, MODIS: 0, VIIRS: 0 };
    bin[record.sensor]++;
    bins.set(period, bin);
  }
  return [...bins.values()].sort((a, b) => a.period.localeCompare(b.period));
}
export function buildBins(
  records: Observation[],
  start: string,
  end: string,
  unit: "month" | "year",
): TimeBin[] {
  if (!start || !end || start > end) return [];
  const counts = new Map(
    aggregate(records, unit).map((bin) => [bin.period, bin]),
  );
  const result: TimeBin[] = [];
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const endTime = Date.parse(`${end}T23:59:59Z`);
  if (unit === "year") cursor.setUTCMonth(0);
  while (cursor.getTime() <= endTime && result.length < 2412) {
    const period = cursor.toISOString().slice(0, unit === "month" ? 7 : 4);
    result.push(counts.get(period) ?? { period, MODIS: 0, VIIRS: 0 });
    if (unit === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }
  return result;
}
export function sensorExtent(datasets: Dataset[], sensor: Sensor) {
  const matching = datasets.filter((d) => d.sensors.includes(sensor));
  if (!matching.length) return null;
  const dates = matching
    .flatMap((d) =>
      d.records.filter((r) => r.sensor === sensor).map((r) => r.date),
    )
    .sort();
  return dates.length
    ? { start: dates[0], end: dates[dates.length - 1] }
    : null;
}
export function withAvailability(
  bins: TimeBin[],
  extents: Record<Sensor, { start: string; end: string } | null>,
): { period: string; MODIS: number | null; VIIRS: number | null }[] {
  return bins.map((bin) => {
    const start =
      bin.period.length === 4 ? `${bin.period}-01-01` : `${bin.period}-01`;
    const end =
      bin.period.length === 4
        ? `${bin.period}-12-31`
        : `${bin.period}-${new Date(Date.UTC(+bin.period.slice(0, 4), +bin.period.slice(5, 7), 0)).getUTCDate()}`;
    const value = (sensor: Sensor) => {
      const extent = extents[sensor];
      return extent && end >= extent.start && start <= extent.end
        ? bin[sensor]
        : null;
    };
    return { period: bin.period, MODIS: value("MODIS"), VIIRS: value("VIIRS") };
  });
}
export function validateBounds(bounds: Bounds): string | null {
  if (Object.values(bounds).some((n) => !Number.isFinite(n)))
    return "Enter all four coordinates as numbers.";
  if (
    Math.abs(bounds.west) > 180 ||
    Math.abs(bounds.east) > 180 ||
    Math.abs(bounds.south) > 90 ||
    Math.abs(bounds.north) > 90
  )
    return "Longitudes must be −180 to 180; latitudes −90 to 90.";
  if (bounds.south >= bounds.north || bounds.west === bounds.east)
    return "North must exceed south, and west and east must differ. West > east selects across the antimeridian.";
  return null;
}
