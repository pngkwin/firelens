// Areas of interest (AOI). Every AOI resolves to lon/lat (multi)polygons; a
// res-5 cell belongs to the AOI iff its centre lies inside (even-odd rule,
// so holes work). "region" means the whole study region (already clipped to
// its boundary upstream) and needs no geometry.

export type LonLat = [number, number];
export type Polys = LonLat[][][]; // MultiPolygon coordinates: polygon -> rings -> points
export type Bbox = [number, number, number, number]; // west, south, east, north

export type Aoi =
  | { kind: "region" }
  | { kind: "preset"; id: string }
  | { kind: "bbox"; bbox: Bbox }
  | { kind: "circle"; center: LonLat; radiusKm: number }
  | { kind: "polygon"; ring: LonLat[] };

export const MAX_RADIUS_KM = 2000;
const EARTH_KM = 6371.0088;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const validLon = (x: number) => Number.isFinite(x) && x >= -180 && x <= 180;
const validLat = (y: number) => Number.isFinite(y) && y >= -90 && y <= 90;

/** Geodesic circle as a polygon (great-circle destination points). */
export function circlePolygon([lon, lat]: LonLat, radiusKm: number, n = 72): LonLat[] {
  const d = radiusKm / EARTH_KM, φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const ring: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const θ = (2 * Math.PI * i) / n;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([r4((((λ2 * 180) / Math.PI + 540) % 360) - 180), r4((φ2 * 180) / Math.PI)]);
  }
  ring.push(ring[0]);
  return ring;
}

const closeRing = (ring: LonLat[]): LonLat[] => {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
};

/** Polygons for an AOI; `preset` supplies geometry for preset ids. Null = whole region. */
export function aoiPolys(aoi: Aoi, preset?: (id: string) => Polys | null): Polys | null {
  switch (aoi.kind) {
    case "region":
      return null;
    case "preset":
      return preset?.(aoi.id) ?? [];
    case "bbox": {
      const [w, s, e, n] = aoi.bbox;
      return [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]];
    }
    case "circle":
      return [[circlePolygon(aoi.center, aoi.radiusKm)]];
    case "polygon":
      return [[closeRing(aoi.ring)]];
  }
}

export function polysBbox(polys: Polys): Bbox {
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of polys) for (const ring of p) for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

/**
 * Bounding boxes for a backend export. Areas that cross the antimeridian (the
 * Aleutians in the Alaska preset) would get a world-wide box from polysBbox;
 * when measuring longitudes on 0–360° gives a narrower span, the area is
 * returned as two boxes, one on each side of 180°.
 */
export function exportBoxes(polys: Polys): Bbox[] {
  const plain = polysBbox(polys);
  let w = 360, e = 0;
  for (const p of polys) for (const ring of p) for (const [x] of ring) { const u = x < 0 ? x + 360 : x; if (u < w) w = u; if (u > e) e = u; }
  if (e - w >= plain[2] - plain[0] || w > 180 || e < 180) return [plain];
  return [[w, plain[1], 180, plain[3]], [-180, plain[1], e - 360, plain[3]]];
}

/** Even-odd point-in-polygon over every ring of every polygon. */
export function inPolys(lon: number, lat: number, polys: Polys): boolean {
  let inside = false;
  for (const p of polys) for (const ring of p) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Point-in-AOI test with a bbox pre-check. */
export function makeAoiTest(polys: Polys | null): (lon: number, lat: number) => boolean {
  if (!polys) return () => true;
  const [w, s, e, n] = polysBbox(polys);
  return (lon, lat) => lon >= w && lon <= e && lat >= s && lat <= n && inPolys(lon, lat, polys);
}

export const bboxIntersects = (a: Bbox, b: Bbox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

// ---- URL encoding ------------------------------------------------------------------
//   region | preset:us-06 | bbox:w,s,e,n | circle:lon,lat,km | poly:lon,lat;lon,lat;...

export function encodeAoi(aoi: Aoi): string {
  switch (aoi.kind) {
    case "region":
      return "region";
    case "preset":
      return `preset:${aoi.id}`;
    case "bbox":
      return `bbox:${aoi.bbox.map(r4).join(",")}`;
    case "circle":
      return `circle:${r4(aoi.center[0])},${r4(aoi.center[1])},${r4(aoi.radiusKm)}`;
    case "polygon":
      return `poly:${aoi.ring.map(([x, y]) => `${r4(x)},${r4(y)}`).join(";")}`;
  }
}

/** Parse and validate; returns an error message instead of throwing. */
export function decodeAoi(s: string | null | undefined): { ok: true; aoi: Aoi } | { ok: false; error: string } {
  if (!s || s === "region") return { ok: true, aoi: { kind: "region" } };
  const [kind, body = ""] = [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)];
  const nums = (t: string) => t.split(",").map(Number);
  if (kind === "preset") return /^[a-z]{2,6}-[0-9a-z]{1,8}$/.test(body) ? { ok: true, aoi: { kind: "preset", id: body } } : { ok: false, error: "Unknown preset id." };
  if (kind === "bbox") {
    const b = nums(body);
    if (b.length !== 4 || !validLon(b[0]) || !validLon(b[2]) || !validLat(b[1]) || !validLat(b[3])) return { ok: false, error: "Bounding box needs west,south,east,north in degrees." };
    if (b[0] >= b[2] || b[1] >= b[3]) return { ok: false, error: "Bounding box must have west < east and south < north." };
    return { ok: true, aoi: { kind: "bbox", bbox: b as Bbox } };
  }
  if (kind === "circle") {
    const [lon, lat, km] = nums(body);
    if (!validLon(lon) || !validLat(lat)) return { ok: false, error: "Circle centre needs a valid longitude and latitude." };
    if (!(km > 0 && km <= MAX_RADIUS_KM)) return { ok: false, error: `Radius must be between 0 and ${MAX_RADIUS_KM} km.` };
    return { ok: true, aoi: { kind: "circle", center: [lon, lat], radiusKm: km } };
  }
  if (kind === "poly") {
    const ring = body.split(";").map((p) => nums(p) as LonLat);
    if (ring.length < 3 || ring.some((p) => p.length !== 2 || !validLon(p[0]) || !validLat(p[1]))) return { ok: false, error: "Polygon needs at least three valid lon,lat vertices." };
    return { ok: true, aoi: { kind: "polygon", ring } };
  }
  return { ok: false, error: "Unrecognized area." };
}

/** Approximate area in km² (spherical excess on an equal-area projection). */
export function polysAreaKm2(polys: Polys): number {
  let total = 0;
  for (const p of polys) for (const [k, ring] of p.entries()) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      a += ((x2 - x1) * Math.PI) / 180 * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
    }
    const area = Math.abs((a * EARTH_KM * EARTH_KM) / 2);
    total += k === 0 ? area : -area;
  }
  return total;
}
