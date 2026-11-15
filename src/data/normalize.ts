import type { Observation, Sensor } from "./types";
export type Row = Record<string, string>;
export const normalizeHeader = (header: string) =>
  header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
export function validateHeaders(fields: string[]) {
  const required = [
    "latitude",
    "longitude",
    "acq_date",
    "acq_time",
    "satellite",
  ];
  const missing = required.filter((key) => !fields.includes(key));
  if (missing.length)
    throw new Error(
      `Missing required columns: ${missing.join(", ")}. Use a FIRMS active-fire CSV export.`,
    );
  if (
    !fields.includes("instrument") &&
    !fields.includes("bright_ti4") &&
    !fields.includes("brightness")
  )
    throw new Error(
      "Cannot identify instrument: include instrument, brightness (MODIS), or bright_ti4 (VIIRS).",
    );
}
export function normalizeRow(row: Row, datasetId: string): Observation {
  const lat = row.latitude?.trim(),
    lon = row.longitude?.trim();
  const latitude = Number(lat),
    longitude = Number(lon);
  if (
    !lat ||
    !lon ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new Error("Invalid latitude or longitude");
  const date = row.acq_date?.trim();
  const inputTime = row.acq_time?.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ||
    !/^\d{1,4}$/.test(inputTime ?? "")
  )
    throw new Error("Invalid acquisition date or HHMM time");
  const time = inputTime.padStart(4, "0");
  if (+time.slice(0, 2) > 23 || +time.slice(2) > 59)
    throw new Error("Acquisition time outside UTC clock range");
  const timestamp = Date.parse(
    `${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`,
  );
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date ||
    +date.slice(0, 4) < 1900 ||
    +date.slice(0, 4) > 2100
  )
    throw new Error("Invalid calendar date (supported years 1900–2100)");
  const rawInstrument = row.instrument?.trim().toUpperCase();
  // FIRMS archive exports can label the VIIRS instrument with its platform.
  const instrument =
    rawInstrument &&
    ["SNPP", "S-NPP", "N20", "N21", "NOAA-20", "NOAA-21"].includes(
      rawInstrument,
    )
      ? "VIIRS"
      : rawInstrument;
  let sensor: Sensor;
  if (instrument) {
    if (instrument !== "MODIS" && instrument !== "VIIRS")
      throw new Error(`Unsupported instrument: ${instrument}`);
    sensor = instrument;
  } else sensor = row.bright_ti4 !== undefined ? "VIIRS" : "MODIS";
  const rawSatellite = row.satellite?.trim();
  if (!rawSatellite) throw new Error("Missing satellite identity");
  const aliases: Record<string, string> = {
    t: "Terra",
    terra: "Terra",
    a: "Aqua",
    aqua: "Aqua",
    n: "S-NPP",
    snpp: "S-NPP",
    "s-npp": "S-NPP",
    "suomi npp": "S-NPP",
    n20: "NOAA-20",
    "noaa-20": "NOAA-20",
    j1: "NOAA-20",
    n21: "NOAA-21",
    "noaa-21": "NOAA-21",
    j2: "NOAA-21",
  };
  const satellite = aliases[rawSatellite.toLowerCase()] ?? rawSatellite;
  if (
    (sensor === "MODIS" &&
      ["S-NPP", "NOAA-20", "NOAA-21"].includes(satellite)) ||
    (sensor === "VIIRS" && ["Terra", "Aqua"].includes(satellite))
  )
    throw new Error("Instrument and satellite disagree");
  const thermal: Record<string, number> = {};
  for (const field of [
    "brightness",
    "bright_t31",
    "bright_ti4",
    "bright_ti5",
    "scan",
    "track",
    "type",
  ]) {
    if (row[field]?.trim() && Number.isFinite(Number(row[field])))
      thermal[field] = Number(row[field]);
  }
  const frp =
    row.frp?.trim() && Number.isFinite(Number(row.frp))
      ? Number(row.frp)
      : undefined;
  return {
    sourceInstrument: row.instrument?.trim() || "Not supplied",
    sourceSatellite: rawSatellite,
    id: `${sensor}|${satellite}|${timestamp}|${latitude}|${longitude}`,
    latitude,
    longitude,
    date,
    time,
    timestamp,
    sensor,
    satellite,
    version: row.version?.trim() || "Not supplied",
    confidence: row.confidence?.trim() || "Not supplied",
    frp: typeof frp === "number" ? frp : undefined,
    thermal,
    daynight: row.daynight?.trim() || "Not supplied",
    datasetId,
  };
}
