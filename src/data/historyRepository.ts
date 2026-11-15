import type { Bounds, Sensor } from "./types";
import { inBounds } from "./analytics";
import {
  periodAvailability,
  type ActivityRow,
  type SensorWindows,
} from "./research";
export type Integrity = {
  file: string;
  sha256: string;
  decodedSha256: string;
  bytes: number;
  decodedBytes: number;
  rows: number;
};
export type AggregateRow = {
  date: string;
  sensor: Sensor;
  platform: string;
  version: string;
  daynight: string;
  source: string;
  cell: string;
  count: number;
};
export type HistoryManifest = {
  format: string;
  version: string;
  extent: { start: string | null; end: string | null; count: number };
  config: { resolutions: number[]; defaultResolution: number };
  coverage: string;
  spatial: string;
  sources: {
    id: string;
    path: string;
    sha256: string;
    accepted: number;
    rejected: number;
    duplicates: number;
    conflicts: number;
    missing: Record<string, number>;
    invalid: Record<string, number>;
    sourceAttributes: {
      version: string;
      instrument: string | null;
      satellite: string | null;
      rows: number;
      duplicates: number;
    }[];
    distribution: {
      sensor: Sensor;
      platform: string;
      version: string;
      start: string;
      end: string;
      count: number;
    }[];
  }[];
  distribution: {
    sensor: Sensor;
    platform: string;
    version: string;
    start: string;
    end: string;
    count: number;
  }[];
  partitions: (Integrity & {
    period: string;
    resolution: number;
    geometry: Integrity;
  })[];
};
const digest = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
async function boundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!stream) throw Error("Missing historical data response");
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw Error(
          "Historical partition exceeds browser query budget; use a smaller partition or local point query",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
const safePath = (path: string) => {
  if (!/^[\w./-]+$/.test(path) || path.includes("..") || path.startsWith("/"))
    throw Error("Invalid history asset path");
  return path;
};
export class StaticHistoryRepository {
  constructor(
    private root = "/data/history",
    private request: typeof fetch = (...args) => fetch(...args),
  ) {}
  async json(path: string, sha256?: string) {
    const response = await this.request(`${this.root}/${safePath(path)}`);
    if (!response.ok)
      throw Error(`Historical data unavailable (${response.status})`);
    const bytes = await boundedBytes(response.body, 8 * 1024 * 1024);
    if (sha256 && (await digest(bytes)) !== sha256)
      throw Error("Historical metadata integrity check failed");
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async manifest(): Promise<HistoryManifest> {
    const pointer = await this.json("latest.json");
    const manifest = (await this.json(
      pointer.manifest,
      pointer.sha256,
    )) as HistoryManifest;
    if (
      manifest.format !== "firelens-history-1" ||
      manifest.version !== pointer.version
    )
      throw Error("Unsupported historical dataset");
    return manifest;
  }
  private async partition<T>(
    version: string,
    asset: Integrity,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const response = await this.request(
      `${this.root}/${safePath(version)}/${safePath(asset.file)}`,
      { signal },
    );
    if (!response.ok)
      throw Error(`Historical partition unavailable (${response.status})`);
    const bytes = await boundedBytes(response.body, 32 * 1024 * 1024);
    let decoded = bytes;
    if (bytes[0] === 31 && bytes[1] === 139) {
      if ((await digest(bytes)) !== asset.sha256)
        throw Error("Historical partition integrity check failed");
      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      decoded = await boundedBytes(stream, 32 * 1024 * 1024);
    }
    if (
      decoded.length !== asset.decodedBytes ||
      (await digest(decoded)) !== asset.decodedSha256
    )
      throw Error("Historical decoded integrity check failed");
    const rows = JSON.parse(new TextDecoder().decode(decoded)) as T[];
    if (rows.length !== asset.rows)
      throw Error("Historical partition row count mismatch");
    return rows;
  }
  async query(
    manifest: HistoryManifest,
    query: {
      start: string;
      end: string;
      resolution?: number;
      sensor?: Sensor;
      platform?: string;
      bounds?: Bounds | null;
    },
    signal?: AbortSignal,
  ) {
    const validDate = (date: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date &&
      date >= "1900-01-01" &&
      date <= "2100-12-31";
    if (
      !validDate(query.start) ||
      !validDate(query.end) ||
      query.start > query.end
    )
      throw Error("Invalid historical date range");
    const resolution = query.resolution ?? manifest.config.defaultResolution;
    if (!manifest.config.resolutions.includes(resolution))
      throw Error("Resolution not preprocessed");
    const counts = new Map<
      string,
      { period: string; MODIS: number; VIIRS: number }
    >();
    let rowsRead = 0;
    for (const part of manifest.partitions.filter(
      (p) =>
        p.resolution === resolution &&
        p.period >= query.start.slice(0, 7) &&
        p.period <= query.end.slice(0, 7),
    )) {
      if (signal?.aborted)
        throw new DOMException("Query cancelled", "AbortError");
      let included: Set<string> | null = null;
      if (query.bounds) {
        const geometry = await this.partition<{
          cell: string;
          latitude: number;
          longitude: number;
        }>(manifest.version, part.geometry, signal);
        included = new Set(
          geometry.filter((g) => inBounds(g, query.bounds!)).map((g) => g.cell),
        );
      }
      const rows = await this.partition<AggregateRow>(
        manifest.version,
        part,
        signal,
      );
      rowsRead += rows.length;
      for (const row of rows) {
        if (
          row.date < query.start ||
          row.date > query.end ||
          (query.sensor && row.sensor !== query.sensor) ||
          (query.platform && row.platform !== query.platform) ||
          (included && !included.has(row.cell))
        )
          continue;
        const period = row.date.slice(0, 7),
          bin = counts.get(period) ?? { period, MODIS: 0, VIIRS: 0 };
        bin[row.sensor] += row.count;
        counts.set(period, bin);
      }
    }
    const windows: SensorWindows = { MODIS: [], VIIRS: [] };
    // Per-source intervals preserve gaps between archive batches; these are not coverage masks.
    for (const source of manifest.sources)
      for (const d of source.distribution)
        if (!query.platform || d.platform === query.platform)
          windows[d.sensor].push({ start: d.start, end: d.end });
    const activity: ActivityRow[] = [];
    const cursor = new Date(`${query.start.slice(0, 7)}-01T00:00:00Z`);
    while (cursor.toISOString().slice(0, 10) <= query.end) {
      const period = cursor.toISOString().slice(0, 7),
        bin = counts.get(period);
      const MODIS_status = periodAvailability(period, query, windows.MODIS),
        VIIRS_status = periodAvailability(period, query, windows.VIIRS);
      const value = (sensor: Sensor, status: string) =>
        (!query.sensor || query.sensor === sensor) &&
        ["within-record-interval", "partial-record-interval"].includes(status)
          ? (bin?.[sensor] ?? 0)
          : null;
      activity.push({
        period,
        MODIS: value("MODIS", MODIS_status),
        VIIRS: value("VIIRS", VIIRS_status),
        MODIS_status,
        VIIRS_status,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return {
      activity,
      resolution,
      rowsRead,
      geography: query.bounds
        ? "Approximate H3 cell-center inclusion"
        : "All preprocessed points",
      coverage: manifest.coverage,
      pointsAvailable: false as const,
    };
  }
}
