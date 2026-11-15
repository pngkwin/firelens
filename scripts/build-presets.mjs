#!/usr/bin/env node
// AOI presets from the same atlases the region clip uses.
//   node scripts/build-presets.mjs
// Writes public/data/presets/<region>.json: [{id, name, polys}] with
// coordinates rounded to 4 decimals (~11 m).
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "public/data/presets");
mkdirSync(OUT, { recursive: true });
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []).map((p) => p.map((ring) => ring.map(([x, y]) => [r4(x), r4(y)])));

function build(region, atlas, object, pick) {
  const topo = require(atlas);
  const fc = feature(topo, topo.objects[object]);
  const items = fc.features.filter(pick).map((f) => ({ id: `${region === "us" ? "us" : "ib"}-${String(f.id)}`, name: f.properties.name, polys: polysOf(f.geometry) })).sort((a, b) => a.name.localeCompare(b.name));
  const json = JSON.stringify({ region, source: `${atlas} (${object})`, items });
  writeFileSync(join(OUT, `${region}.json`), json);
  console.log(`${region}: ${items.length} presets, ${(json.length / 1024).toFixed(0)} KB, sha256 ${createHash("sha256").update(json).digest("hex").slice(0, 12)}`);
}
build("us", "us-atlas/states-10m.json", "states", (f) => +f.id <= 56); // 50 states + DC; territories are outside the study boxes
build("iberia", "world-atlas/countries-50m.json", "countries", (f) => ["724", "620"].includes(String(f.id)));
