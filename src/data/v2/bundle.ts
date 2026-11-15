// Client for the static, hash-verified v2 bundle (public/data/v2/<region>).
// Every partition is checked against the manifest's sha256 before use. Hosts
// that transparently decompress .gz are handled: raw gzip bytes are checked
// against `sha256`, already-decoded JSON against `decodedSha256`.
import type { V2Partition } from "./codec";

export type ManifestFile = { path: string; bytes: number; sha256: string; decodedSha256: string; rows: number };
export type MonthInfo = { status: string; detections: number | null; excludedStatic: number | null; outsideRegion: number | null; origins: string[] | null; fineCellDays: number | null; detectionsBySource: Record<string, number> | null };
export type Manifest = {
  v: 2;
  region: { id: string; name: string; boxes: Array<{ id: string; bbox: number[] }> };
  product: { unit: string; definition: string; zeroMeaning: string; areaCaveat: string; clip: Record<string, unknown>; staticSourceMask: { rule: string; cells: number }; [k: string]: unknown };
  sources: Record<string, { id: string; sensor: string; kind: string; platform?: string; available: { min: string; max: string } | null; endOfProduction?: string }>;
  planEnd: string;
  months: Record<string, MonthInfo>;
  code: Record<string, string>;
  files: ManifestFile[];
};
export type RatioEntry = { k: number | null; m: number; v: number; n: number };
export type Interval = { lo: number; hi: number; outOfSampleCoverage: number; n: number };
export type Calibration = {
  method: string; // version, e.g. fcd-harmonize-v2
  region: string;
  inputManifestSha256: string;
  trainingYears: [number, number];
  periods: { aquaStart: string; driftStart: string };
  periodRule: Record<string, string>;
  selection: { selected: "stratified" | "qm"; rule: string; looMonthlyMae: Record<string, number> };
  viirsCover: Partial<Record<"S-NPP" | "NOAA-20" | "NOAA-21", [string, string] | null>>;
  crossCalibration: Record<string, { k: number | null; months: number }>;
  rho: Record<string, number | null>;
  viirsToModis: Record<string, RatioEntry>;
  terraToModis: Record<string, RatioEntry>;
  qm: { x: number[]; m: number[]; basis: string };
  interval90: Interval | null;
  terraInterval90: Interval | null;
  viirsLevel: { basis: string; modisToViirsByMoy: Record<string, number | null> };
  regionSeries: Record<string, { cls: string; value: number | null; lo: number | null; hi: number | null; viirsLevel: number | null; viirsObserved: boolean }>;
};

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (data: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : (data as Uint8Array<ArrayBuffer>)));

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

export type BundleClient = ReturnType<typeof createBundle>;

export function createBundle(region: string, opts: { base?: string; fetchImpl?: typeof fetch } = {}) {
  const base = `${(opts.base ?? "/data/v2").replace(/\/$/, "")}/${region}`;
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, f: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, f().catch((e) => { cache.delete(key); throw e; }));
    return cache.get(key) as Promise<T>;
  };
  const get = async (path: string, init?: RequestInit) => {
    const res = await (init ? fetchImpl(`${base}/${path}`, init) : fetchImpl(`${base}/${path}`));
    if (!res.ok) throw Error(`${region}/${path}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };

  const manifestText = () => once("manifest.json", async () => new TextDecoder().decode(await get("manifest.json")));
  const manifest = () => once("manifest", async () => {
    const m = JSON.parse(await manifestText()) as Manifest;
    if (m.v !== 2 || !Array.isArray(m.files)) throw Error(`${region}: not a v2 manifest`);
    return m;
  });
  const manifestSha = () => once("manifestSha", async () => sha256(await manifestText()));

  async function partition(path: string): Promise<V2Partition> {
    return once(`p:${path}`, async () => {
      const entry = (await manifest()).files.find((f) => f.path === path);
      if (!entry) throw Error(`${region}/${path} is not listed in the manifest`);
      // Bundle files are served with a long browser cache; paths are not
      // content-hashed, so a stale copy from before a republish fails the
      // check and is fetched once more, bypassing the cache.
      const verified = async (init?: RequestInit): Promise<string | null> => {
        const bytes = await get(path, init);
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) return (await sha256(bytes)) === entry.sha256 ? await gunzip(bytes) : null;
        const text = new TextDecoder().decode(bytes);
        return (await sha256(text)) === entry.decodedSha256 ? text : null;
      };
      const json = (await verified()) ?? (await verified({ cache: "reload" }));
      if (json == null) throw Error(`${region}/${path}: checksum mismatch`);
      const p = JSON.parse(json) as V2Partition;
      if (p.rows.length !== entry.rows) throw Error(`${region}/${path}: row count differs from manifest`);
      return p;
    });
  }

  const calibration = () => once("calibration", async () => {
    const text = new TextDecoder().decode(await get("calibration.json"));
    const cal = JSON.parse(text) as Calibration;
    if (cal.inputManifestSha256 !== (await manifestSha())) throw Error(`${region}: calibration was fitted on a different manifest`);
    if (!cal.selection) throw Error(`${region}: calibration predates method v2`);
    return { cal, sha256: await sha256(text) };
  });

  return { region, base, manifest, manifestSha, partition, calibration };
}
