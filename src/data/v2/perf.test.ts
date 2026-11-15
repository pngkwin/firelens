// AOI query performance on the US dataset (Phase 6 requirement: < 1 s).
// Times the browser code path end to end from local files: shard planning,
// hash-verified loading + gunzip + parse, aggregation and harmonization.
// Network transfer is excluded (localhost / CDN dependent).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createBundle } from "./bundle";
import { addMonthly, ensureMonths, harmonize, planAoi, regionReferenceX, zonesOnly, type CellIndex, type MonthZones } from "./series";
import { aoiPolys, makeAoiTest, type Aoi, type Polys } from "./aoi";

const ROOT = resolve(import.meta.dirname, "../../..");
const fileFetch = (async (url: string) => {
  const p = join(ROOT, "public", String(url));
  return existsSync(p) ? new Response(readFileSync(p) as Uint8Array<ArrayBuffer>) : new Response("missing", { status: 404 });
}) as typeof fetch;
const presets = JSON.parse(readFileSync(join(ROOT, "public/data/presets/us.json"), "utf8")) as { items: Array<{ id: string; name: string; polys: Polys }> };
const preset = (name: string) => presets.items.find((p) => p.name === name)!.polys;

const cases: Array<[string, Polys | null]> = [
  ["whole US (zone level)", null],
  ["California", preset("California")],
  ["Texas", preset("Texas")],
  ["Alaska", preset("Alaska")],
  ["CONUS bounding box", aoiPolys({ kind: "bbox", bbox: [-125, 24, -66, 50] } as Aoi)],
  ["50 km circle near Paradise, CA", aoiPolys({ kind: "circle", center: [-121.6, 39.76], radiusKm: 50 } as Aoi)],
];

describe("US AOI query time (cold, per query)", () => {
  it.each(cases)("%s < 1 s", async (_name, polys) => {
    const b = createBundle("us", { fetchImpl: fileFetch }); // fresh client: nothing cached
    const t0 = performance.now();
    const [m, { cal }, zm] = await Promise.all([b.manifest(), b.calibration(), b.partition("zone-monthly.json.gz")]);
    const opts = { dataEnd: m.planEnd, planEnd: m.planEnd };
    const region: MonthZones = new Map();
    addMonthly(region, zm, null);
    let months = region;
    if (polys) {
      const keep = makeAoiTest(polys);
      const plan = planAoi((await b.partition("cells.json.gz")) as unknown as CellIndex, keep);
      months = new Map();
      addMonthly(months, zonesOnly(zm, new Set(plan.full)), null);
      for (const p of await Promise.all(plan.partial.map((s) => b.partition(`monthly/${s}.json.gz`)))) addMonthly(months, p, keep);
      ensureMonths(months, region.keys());
    }
    const res = harmonize(months, cal, { ...opts, regionX: polys ? regionReferenceX(region, cal, opts) : undefined, aoiNoise: !!polys });
    const ms = performance.now() - t0;
    console.log(`${_name}: ${ms.toFixed(0)} ms, ${res.length} months`);
    expect(res.length).toBe(313);
    expect(ms).toBeLessThan(1000);
  });
});
