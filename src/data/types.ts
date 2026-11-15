export type Sensor = "MODIS" | "VIIRS";
export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};
export interface Observation {
  sourceInstrument: string;
  sourceSatellite: string;
  id: string;
  latitude: number;
  longitude: number;
  date: string;
  time: string;
  timestamp: number;
  sensor: Sensor;
  satellite: string;
  version: string;
  confidence: string;
  frp?: number;
  thermal: Record<string, number>;
  daynight: string;
  datasetId: string;
}
export interface Dataset {
  id: string;
  name: string;
  hash: string;
  source: string;
  importedAt: string;
  records: Observation[];
  sensors: Sensor[];
  satellites: string[];
  versions: string[];
  start: string;
  end: string;
  rejected: number;
  duplicates: number;
  warnings: string[];
}
export interface Filters {
  start: string;
  end: string;
  sensor: "all" | Sensor;
  bounds: Bounds | null;
  month: string | null;
}
export const emptyFilters: Filters = {
  start: "",
  end: "",
  sensor: "all",
  bounds: null,
  month: null,
};
export interface ParseResult {
  records: Observation[];
  rejected: number;
  duplicates: number;
  warnings: string[];
}
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDS = 100_000;
