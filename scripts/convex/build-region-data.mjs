#!/usr/bin/env node
// Generate the per-region data the Convex backend needs to aggregate NRT
// detections exactly like the offline pipeline:
//
//   node scripts/convex/build-region-data.mjs
//
// Writes convex/regionData/<id>.json with
//   boxes        FIRMS area-API acquisition boxes (config/regions.json)
//   clip         H3 res-7 region cells, losslessly compacted (compactCells)
//   staticCells  the static-source res-8 mask used by the published bundle
//   bundleEnd    last day covered by public/data/v2/<id> (manifest planEnd)
// Rerun (and redeploy Convex) whenever a region's v2 bundle is republished.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { compactCells, cellToParent, getResolution } from "h3-js";
import { regionCells, CLIP_RES } from "../ingest/clip.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const config = JSON.parse(readFileSync(join(ROOT, "config/regions.json"), "utf8"));
const OUT = join(ROOT, "convex/regionData");
mkdirSync(OUT, { recursive: true });
const sha = (s) => createHash("sha256").update(s).digest("hex");

const index = [];
for (const region of config.regions) {
  const manifestFile = join(ROOT, "public/data/v2", region.id, "manifest.json");
  const staticFile = join(ROOT, "data/processed/agg", region.id, "static-cells.json");
  if (!existsSync(manifestFile) || !existsSync(staticFile)) {
    console.log(`${region.id}: skipped (no published v2 bundle or static mask)`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const staticInfo = JSON.parse(readFileSync(staticFile, "utf8"));
  if (staticInfo.cells.length !== manifest.product.staticSourceMask.cells)
    throw Error(`${region.id}: static mask (${staticInfo.cells.length}) differs from published bundle (${manifest.product.staticSourceMask.cells})`);
  const cells = [...regionCells(region)];
  const compact = compactCells(cells).sort();
  // Lossless check: every region cell has exactly one compacted ancestor.
  const set = new Set(compact);
  for (const c of cells) {
    let hit = 0;
    for (let r = CLIP_RES; r >= 0; r--) if (set.has(r === CLIP_RES ? c : cellToParent(c, r))) hit++;
    if (hit !== 1) throw Error(`${region.id}: compaction check failed for ${c}`);
  }
  const resolutions = [...new Set(compact.map(getResolution))].sort();
  const data = {
    id: region.id,
    name: region.name,
    boxes: region.boxes,
    clip: { spec: region.clip, res: CLIP_RES, cells: cells.length, compact },
    staticCells: staticInfo.cells,
    staticRule: staticInfo.rule,
    bundleEnd: manifest.planEnd,
  };
  const json = JSON.stringify(data);
  writeFileSync(join(OUT, `${region.id}.json`), json);
  index.push({ id: region.id, bundleEnd: manifest.planEnd, sha256: sha(json) });
  console.log(`${region.id}: clip ${cells.length} res-${CLIP_RES} cells -> ${compact.length} compacted (res ${resolutions.join(",")}); static ${staticInfo.cells.length}; bundleEnd ${manifest.planEnd}; ${(json.length / 1024).toFixed(0)} KB`);
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 1));
