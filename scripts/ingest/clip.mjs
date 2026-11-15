// Region clip: a detection belongs to a region iff the centre of its H3
// resolution-7 cell (~5.2 km²) lies inside the region's boundary polygon.
// Deterministic and identical for every source (archive or API), so the
// spatial footprint cannot change at the SP/NRT stitch.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { polygonToCells, cellToParent, latLngToCell } from "h3-js";
import { feature } from "topojson-client";

export const CLIP_RES = 7;
const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "../..");

export function regionPolygons(clip) {
  const topo = require(clip.atlas);
  const fc = feature(topo, topo.objects[clip.object]);
  const feats = (fc.features ?? [fc]).filter((f) => !clip.ids || clip.ids.includes(String(f.id)));
  const polys = [];
  for (const f of feats) {
    const g = f.geometry;
    if (g.type === "Polygon") polys.push(g.coordinates);
    else if (g.type === "MultiPolygon") polys.push(...g.coordinates);
  }
  return polys;
}

/** Set of res-7 cells whose centres fall inside the region (cached on disk). */
export function regionCells(region) {
  const cache = join(ROOT, "data/processed/clip", `${region.id}-r${CLIP_RES}.json`);
  if (existsSync(cache)) {
    const c = JSON.parse(readFileSync(cache, "utf8"));
    if (JSON.stringify(c.clip) === JSON.stringify(region.clip)) return new Set(c.cells);
  }
  const cells = new Set();
  for (const poly of regionPolygons(region.clip))
    for (const c of polygonToCells(poly, CLIP_RES, true)) cells.add(c);
  mkdirSync(join(ROOT, "data/processed/clip"), { recursive: true });
  writeFileSync(cache, JSON.stringify({ clip: region.clip, res: CLIP_RES, cells: [...cells].sort() }));
  return cells;
}

export function makeClip(region) {
  if (!region.clip) return null;
  const cells = regionCells(region);
  return {
    cells,
    hasCell8: (cell8) => cells.has(cellToParent(cell8, CLIP_RES)),
    hasPoint: (lat, lon) => cells.has(latLngToCell(lat, lon, CLIP_RES)),
  };
}
