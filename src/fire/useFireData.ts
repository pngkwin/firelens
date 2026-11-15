// Loads and harmonizes the v2 bundle (+ live NRT days) for a region and AOI.
import { useEffect, useRef, useState } from "react";
import { cellToBoundary } from "h3-js";
import { createBundle, type BundleClient, type Calibration, type Manifest } from "../data/v2/bundle";
import { aoiPolys, bboxIntersects, encodeAoi, makeAoiTest, polysBbox, type Aoi, type Bbox, type Polys } from "../data/v2/aoi";
import { buildEvents, type FireEvent } from "../data/v2/events";
import { addDaily, addMonthly, cellCentre, ensureMonths, planAoi, zonesOnly, type CellIndex, harmonize, harmonizeDays, regionReferenceX, type DayResult, type DayVals, type MonthResult, type MonthZones } from "../data/v2/series";
import { loadLiveCells, loadLiveTotals, type LiveDay, type LiveStatus } from "../data/v2/live";
import type { V2Partition } from "../data/v2/codec";
import type { RegionId } from "../data/v2/urlState";

export type Preset = { id: string; name: string; polys: Polys };
export type FireData = {
  status: "loading" | "ready" | "error";
  error?: string;
  progress: string;
  manifest?: Manifest;
  manifestSha?: string;
  cal?: Calibration;
  calSha?: string;
  presets: Preset[];
  polys: Polys | null; // null = whole region
  months: MonthResult[];
  days: DayResult[] | null; // null while daily data loads
  dataEnd?: string;
  live: { status: LiveStatus; days: LiveDay[] };
  filesUsed: Array<{ path: string; sha256: string }>;
  cellsInAoi: number;
  timing: { monthlyMs: number; loadMs: number; computeMs: number; liveMs: number; dailyMs: number | null; eventsMs?: number };
  events: FireEvent[] | null; // null: not computed (whole region, too large, or loading)
  eventsNote: string;
  overview?: V2Partition;
};

/** Episode grouping limit (res-5 cells with data in the area). */
export const EVENT_MAX_CELLS = 8000;
const bundles = new Map<string, BundleClient>();
const bundleFor = (r: string) => bundles.get(r) ?? bundles.set(r, createBundle(r)).get(r)!;
const presetCache = new Map<string, Promise<Preset[]>>();
export function loadPresets(region: string): Promise<Preset[]> {
  if (!presetCache.has(region))
    presetCache.set(region, fetch(`/data/presets/${region}.json`).then(async (r) => (r.ok ? ((await r.json()) as { items: Preset[] }).items : [])).catch(() => []));
  return presetCache.get(region)!;
}

/** res-1 shard bounding box (antimeridian-crossing shards: whole longitude range). */
function shardBbox(shard: string): Bbox {
  const pts = cellToBoundary(shard, true);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const w = Math.min(...xs), e = Math.max(...xs);
  return e - w > 180 ? [-180, Math.min(...ys), 180, Math.max(...ys)] : [w, Math.min(...ys), e, Math.max(...ys)];
}

const EMPTY: FireData = { status: "loading", progress: "", presets: [], polys: null, months: [], days: null, live: { status: { configured: false }, days: [] }, filesUsed: [], cellsInAoi: 0, events: null, eventsNote: "", timing: { monthlyMs: 0, loadMs: 0, computeMs: 0, liveMs: 0, dailyMs: null } };

export function useFireData(region: RegionId, aoi: Aoi): FireData {
  const [data, setData] = useState<FireData>(EMPTY);
  const token = useRef(0);
  const aoiKey = encodeAoi(aoi);
  useEffect(() => {
    const my = ++token.current;
    const alive = () => token.current === my;
    const b = bundleFor(region);
    const update = (patch: Partial<FireData>) => { if (alive()) setData((d) => ({ ...d, ...patch })); };
    setData((d) => ({ ...EMPTY, presets: d.manifest?.region.id === region ? d.presets : [], progress: "Loading verified bundle…" }));
    (async () => {
      const t0 = performance.now();
      const manifest = await b.manifest();
      // Live NRT days after the bundle end (Convex) load in parallel and are merged
      // when they arrive, so backend latency never delays the bundle result.
      const tLive = performance.now();
      const livePromise = loadLiveTotals(region, manifest.planEnd).then(async (live) => ({
        live,
        parts: live.days.length ? (await loadLiveCells(region, live.days.map((d) => d.day)).catch(() => [])).map((x) => x.partition) : [],
        ms: performance.now() - tLive,
      }));
      const [manifestSha, { cal, sha256: calSha }, zoneMonthly, presets] = await Promise.all([b.manifestSha(), b.calibration(), b.partition("zone-monthly.json.gz"), loadPresets(region)]);
      const listed = (path: string) => manifest.files.some((f) => f.path === path);
      const shaOf = (path: string) => manifest.files.find((f) => f.path === path)!.sha256;
      const filesUsed = [{ path: "zone-monthly.json.gz", sha256: shaOf("zone-monthly.json.gz") }];
      const polys = aoi.kind === "preset" ? (presets.find((p) => p.id === aoi.id)?.polys ?? null) : aoiPolys(aoi);
      if (aoi.kind === "preset" && !polys) throw Error(`Unknown area preset "${aoi.id}" for this region.`);
      const keep = polys ? makeAoiTest(polys) : null;

      const regionMonths: MonthZones = new Map();
      addMonthly(regionMonths, zoneMonthly, null);
      const tLoaded = performance.now();
      let months: MonthZones = regionMonths;
      let shards: string[] = [];
      let fullShards: string[] = []; // every cell centre inside: zone-level files suffice for values
      let shardLoadMs = 0;
      let cellsInAoi = 0;
      const tShards = performance.now();
      if (polys && aoi.kind === "preset" && listed(`aoi/${aoi.id}.json.gz`)) {
        // Precomputed per-zone aggregate (same cell-centre rule, verified bundle file).
        const p = (await b.partition(`aoi/${aoi.id}.json.gz`)) as typeof zoneMonthly & { aoi?: { cellsInside: number } };
        months = new Map();
        addMonthly(months, p, null);
        cellsInAoi = p.aoi?.cellsInside ?? 0;
        shards = p.cells;
        filesUsed.push({ path: `aoi/${aoi.id}.json.gz`, sha256: shaOf(`aoi/${aoi.id}.json.gz`) });
      } else if (polys) {
        // Shards whose every cell centre is inside use zone-monthly; only shards cut
        // by the AOI boundary are downloaded and filtered (exact, cell-centre rule).
        const index = (await b.partition("cells.json.gz")) as unknown as CellIndex;
        const bb = polysBbox(polys);
        const near: CellIndex = { cells: index.cells, rows: index.rows.filter(([i]) => bboxIntersects(shardBbox(index.cells[i]), bb)) };
        const plan = planAoi(near, keep!);
        cellsInAoi = plan.cellsInside;
        shards = [...plan.full, ...plan.partial];
        fullShards = plan.full;
        update({ progress: `Loading ${plan.partial.length} boundary shard${plan.partial.length === 1 ? "" : "s"} for the area…` });
        const parts = await Promise.all(plan.partial.map((s) => b.partition(`monthly/${s}.json.gz`)));
        months = new Map();
        addMonthly(months, zonesOnly(zoneMonthly, new Set(plan.full)), null);
        for (const p of parts) addMonthly(months, p, keep);
        filesUsed.push({ path: "cells.json.gz", sha256: shaOf("cells.json.gz") }, ...plan.partial.map((s) => ({ path: `monthly/${s}.json.gz`, sha256: shaOf(`monthly/${s}.json.gz`) })));
      }
      if (polys) shardLoadMs = performance.now() - tShards;
      if (polys) ensureMonths(months, regionMonths.keys()); // AOI months without records are zeros

      const run = (dataEnd: string) => {
        const opts = { dataEnd, planEnd: manifest.planEnd };
        return harmonize(months, cal, { ...opts, regionX: polys ? regionReferenceX(regionMonths, cal, opts) : undefined, aoiNoise: !!polys });
      };
      let monthly = run(manifest.planEnd);
      const monthlyMs = performance.now() - t0;
      const computeMs = performance.now() - tLoaded - shardLoadMs;
      const timing: FireData["timing"] = { monthlyMs, loadMs: monthlyMs - computeMs, computeMs, liveMs: 0, dailyMs: null };
      update({ status: "ready", progress: "Checking live near-real-time days…", manifest, manifestSha, cal, calSha, presets, polys, months: monthly, dataEnd: manifest.planEnd, filesUsed: [...filesUsed], cellsInAoi, timing: { ...timing } });

      // Merge live days (they only extend past the bundle end).
      const { live, parts: liveParts, ms } = await livePromise;
      timing.liveMs = ms;
      let dataEnd = manifest.planEnd;
      if (liveParts.length) {
        dataEnd = live.days[live.days.length - 1].day;
        for (const p of liveParts) { addMonthly(regionMonths, p, null); if (polys) addMonthly(months, p, keep); }
        monthly = run(dataEnd);
      }
      update({ live, months: monthly, dataEnd, progress: "Loading daily data…", timing: { ...timing } });

      // Daily values (day-of-year calendar, month-to-date comparisons) in the background.
      // Fully covered shards use zone-daily; boundary shards use daily cell files.
      const t1 = performance.now();
      const dayVals: DayVals = new Map();
      const fullSet = new Set(fullShards);
      const cellFilesFor = (ss: string[]) => manifest.files.filter((f) => f.path.startsWith("daily/") && ss.includes(f.path.split("/")[1])).map((f) => f.path);
      const dailyFiles = polys ? cellFilesFor(shards.filter((s) => !fullSet.has(s))) : ["region-daily.json.gz"];
      if (fullShards.length) {
        addDaily(dayVals, zonesOnly(await b.partition("zone-daily.json.gz"), fullSet), null);
        filesUsed.push({ path: "zone-daily.json.gz", sha256: shaOf("zone-daily.json.gz") });
      }
      let done = 0;
      const cellParts = await Promise.all(dailyFiles.map(async (path) => {
        const p = await b.partition(path);
        addDaily(dayVals, p, keep);
        done++;
        if (done % 10 === 0) update({ progress: `Loading daily data… ${done}/${dailyFiles.length} files` });
        return p;
      }));
      for (const p of liveParts) addDaily(dayVals, p, keep);
      const days = harmonizeDays(dayVals, monthly);
      filesUsed.push(...dailyFiles.map((p) => ({ path: p, sha256: shaOf(p) })));
      timing.dailyMs = performance.now() - t1;
      update({ days, progress: polys ? "Grouping fire episodes…" : "", filesUsed: [...filesUsed], timing: { ...timing } });

      // Fire episodes need cell-level days, clustered inside the area only.
      if (!polys) update({ events: null, eventsNote: "Choose an area (state, box, circle or polygon) to compare fire episodes: they are grouped inside the selected area." });
      else if (cellsInAoi > EVENT_MAX_CELLS) update({ events: null, progress: "", eventsNote: `This area has ${cellsInAoi.toLocaleString()} cells with data; fire episodes are grouped for areas up to ${EVENT_MAX_CELLS.toLocaleString()} cells (about 2 million km²). Choose a smaller area or a state.` });
      else {
        const t2 = performance.now();
        const fullParts = await Promise.all(cellFilesFor(fullShards).map((p) => b.partition(p)));
        const inside = (c: string) => keep!(...cellCentre(c));
        const events = buildEvents([...cellParts, ...fullParts, ...liveParts], inside);
        timing.eventsMs = performance.now() - t2;
        update({ events, eventsNote: "", progress: "", timing: { ...timing } });
      }
      b.partition("overview.json.gz").then((overview) => update({ overview })).catch(() => {});
    })().catch((e) => update({ status: "error", error: e instanceof Error ? e.message : String(e), progress: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, aoiKey]);
  return data;
}
