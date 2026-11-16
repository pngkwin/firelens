import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as GLMap, MapMouseEvent } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Feature, FeatureCollection } from "geojson";
import { cellToBoundary } from "h3-js";
import type { V2Partition } from "../data/v2/codec";
import { circlePolygon, type Aoi, type LonLat, type Polys } from "../data/v2/aoi";
import { fmt, sequential, shareColor } from "./colors";
import { cellSplits, shares } from "../data/v2/disagreement";
import type { MapLayer } from "./DisagreementAtlas";
maplibregl.setWorkerUrl(mapWorkerUrl);

export type DrawMode = "none" | "polygon" | "rectangle" | "circle";
export type MapPoint = { lon: number; lat: number; label: string };
type Props = { polys: Polys | null; overview?: V2Partition; layer?: MapLayer; points?: MapPoint[]; fromYear: number; toYear: number; home: [number, number, number, number]; mode: DrawMode; onMode: (m: DrawMode) => void; onAoi: (a: Aoi) => void };

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
const haversineKm = (a: LonLat, b: LonLat) => {
  const R = 6371.0088, rad = Math.PI / 180;
  const dφ = (b[1] - a[1]) * rad, dλ = (b[0] - a[0]) * rad;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export function AoiMap({ polys, overview, points, layer = "activity", fromYear, toYear, home, mode, onMode, onAoi }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<GLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pts, setPts] = useState<LonLat[]>([]);
  const [cursor, setCursor] = useState<LonLat | null>(null);
  const live = useRef({ mode, pts, onAoi, onMode });
  live.current = { mode, pts, onAoi, onMode };

  // Overview hexes: raw any-sensor fire-cell-days over the selected years.
  const hexes = useMemo<{ fc: FeatureCollection; max: number }>(() => {
    if (!overview) return { fc: empty, max: 1 };
    if (layer !== "activity") {
      // Sensor disagreement: share of the cell's union (any sensor) in one category, years with VIIRS in orbit.
      const key = layer === "viirs-only" ? "viirsOnly" : layer === "modis-only" ? "modisOnly" : "both";
      const sp = cellSplits(overview.rows as unknown as number[][], overview.periods, Math.max(2012, fromYear), toYear);
      const features: Feature[] = [];
      for (const [i, s] of sp) {
        if (s.union < 20) continue; // too few cell-days for a stable share
        const v = shares(s)![key];
        const ring = cellToBoundary(overview.cells[i], true);
        const xs = ring.map((p) => p[0]);
        if (Math.max(...xs) - Math.min(...xs) > 180) continue;
        features.push({ type: "Feature", properties: { v, color: shareColor(v) }, geometry: { type: "Polygon", coordinates: [ring] } });
      }
      return { fc: { type: "FeatureCollection", features }, max: 1 };
    }
    const sums = new Map<number, number>();
    overview.rows.forEach((w) => {
      const y = +overview.periods[w[1]];
      if (y >= fromYear && y <= toYear) sums.set(w[0], (sums.get(w[0]) ?? 0) + (w[2] as unknown as number));
    });
    const max = Math.max(1, ...sums.values());
    const color = sequential(max);
    const features: Feature[] = [];
    for (const [i, v] of sums) {
      const ring = cellToBoundary(overview.cells[i], true);
      const xs = ring.map((p) => p[0]);
      if (Math.max(...xs) - Math.min(...xs) > 180) continue; // antimeridian hexes are skipped in this overview
      features.push({ type: "Feature", properties: { v, color: color(v) }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
    return { fc: { type: "FeatureCollection", features }, max };
  }, [overview, fromYear, toYear, layer]);

  const aoiFc = useMemo<FeatureCollection>(() => (polys ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polys } }] } : empty), [polys]);

  const draft = useMemo<FeatureCollection>(() => {
    if (mode === "none" || !pts.length) return empty;
    const c = cursor ?? pts[pts.length - 1];
    let ring: LonLat[] | null = null;
    if (mode === "polygon") ring = [...pts, c];
    if (mode === "rectangle") ring = [[pts[0][0], pts[0][1]], [c[0], pts[0][1]], [c[0], c[1]], [pts[0][0], c[1]], [pts[0][0], pts[0][1]]];
    if (mode === "circle") ring = circlePolygon(pts[0], Math.max(0.5, haversineKm(pts[0], c)));
    return { type: "FeatureCollection", features: ring ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } }] : [] };
  }, [mode, pts, cursor]);

  useEffect(() => {
    if (!el.current) return;
    let m: GLMap;
    try {
      m = new maplibregl.Map({ container: el.current, style: "https://tiles.openfreemap.org/styles/positron", bounds: [[home[0], home[1]], [home[2], home[3]]], attributionControl: { compact: true }, doubleClickZoom: false });
    } catch {
      setError("The map could not start (WebGL unavailable). Use the area forms instead.");
      return;
    }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("error", () => {}); // basemap tile errors must not break the app
    m.on("load", () => {
      m.addSource("hex", { type: "geojson", data: empty });
      m.addLayer({ id: "hex", type: "fill", source: "hex", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.72 } });
      m.addSource("aoi", { type: "geojson", data: empty });
      m.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#b54c20", "line-width": 2.5 } });
      m.addSource("incidents", { type: "geojson", data: empty });
      m.addLayer({ id: "incidents", type: "circle", source: "incidents", paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": "#b54c20", "circle-stroke-width": 3 } });
      m.addSource("draft", { type: "geojson", data: empty });
      m.addLayer({ id: "draft", type: "line", source: "draft", paint: { "line-color": "#173e36", "line-width": 2, "line-dasharray": [2, 1] } });
      setReady(true);
    });
    const ll = (e: MapMouseEvent): LonLat => [Math.round(e.lngLat.lng * 1e4) / 1e4, Math.round(e.lngLat.lat * 1e4) / 1e4];
    m.on("click", (e) => {
      const { mode, pts, onAoi, onMode } = live.current;
      if (mode === "none") return;
      const p = ll(e);
      if (mode === "polygon") return setPts([...pts, p]);
      if (!pts.length) return setPts([p]);
      if (mode === "rectangle") {
        const [a, b] = [pts[0], p];
        if (a[0] !== b[0] && a[1] !== b[1]) onAoi({ kind: "bbox", bbox: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
      } else onAoi({ kind: "circle", center: pts[0], radiusKm: Math.round(Math.max(1, haversineKm(pts[0], p)) * 10) / 10 });
      setPts([]); onMode("none");
    });
    m.on("dblclick", () => {
      const { mode, pts, onAoi, onMode } = live.current;
      if (mode === "polygon" && pts.length >= 3) { onAoi({ kind: "polygon", ring: pts }); setPts([]); onMode("none"); }
    });
    m.on("mousemove", (e) => { if (live.current.mode !== "none") setCursor(ll(e)); });
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (ready) (map.current?.getSource("hex") as GeoJSONSource | undefined)?.setData(hexes.fc); }, [ready, hexes]);
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource("aoi") as GeoJSONSource).setData(aoiFc);
    if (polys) {
      let w = 180, s = 90, e = -180, n = -90;
      for (const p of polys) for (const r of p) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
      if (e - w < 300) map.current.fitBounds([[w, s], [e, n]], { padding: 30, duration: 0, maxZoom: 9 });
    } else map.current.fitBounds([[home[0], home[1]], [home[2], home[3]]], { duration: 0 });
  }, [ready, aoiFc, polys, home]);
  const pointFc = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features: (points ?? []).map((p) => ({ type: "Feature", properties: { label: p.label }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) }), [points]);
  useEffect(() => { if (ready) (map.current?.getSource("incidents") as GeoJSONSource | undefined)?.setData(pointFc); }, [ready, pointFc]);
  useEffect(() => { if (ready) (map.current?.getSource("draft") as GeoJSONSource | undefined)?.setData(draft); }, [ready, draft]);
  useEffect(() => {
    setPts([]);
    if (map.current) map.current.getCanvas().style.cursor = mode === "none" ? "" : "crosshair";
  }, [mode]);
  useEffect(() => {
    if (ready) map.current?.getCanvas().setAttribute("aria-label", "Map of the study region. Draw tools are above it; the bounding box, point and polygon-vertex forms are the keyboard alternative.");
  }, [ready]);

  // Scoped to the map area: Escape anywhere in it cancels; Enter finishes a polygon only
  // from the map itself (Enter on a button keeps its own meaning, e.g. "Finish polygon").
  const onKey = (e: ReactKeyboardEvent) => {
    if (live.current.mode === "none") return;
    if (e.key === "Escape") { setPts([]); onMode("none"); }
    if (e.key === "Enter" && el.current?.contains(e.target as Node) && live.current.mode === "polygon" && live.current.pts.length >= 3) {
      e.preventDefault();
      onAoi({ kind: "polygon", ring: live.current.pts }); setPts([]); onMode("none");
    }
  };

  const hint = mode === "polygon" ? `Click to add vertices (${pts.length}); double-click or press Enter on the map to finish; Esc cancels.` : mode === "rectangle" ? (pts.length ? "Click the opposite corner." : "Click the first corner.") : mode === "circle" ? (pts.length ? "Click to set the radius." : "Click the centre.") : "";
  return (
    <div className="fc-map-wrap" onKeyDown={onKey}>
      <div className="fc-draw-tools" role="group" aria-label="Draw an area on the map">
        {(["polygon", "rectangle", "circle"] as const).map((m) => (
          <button key={m} type="button" className={`button small${mode === m ? " primary" : ""}`} aria-pressed={mode === m} onClick={() => onMode(mode === m ? "none" : m)}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
        {mode === "polygon" && pts.length >= 3 && (
          <button type="button" className="button small" onClick={() => { onAoi({ kind: "polygon", ring: pts }); setPts([]); onMode("none"); }}>Finish polygon</button>
        )}
      </div>
      <div ref={el} className="fc-map" aria-busy={!ready} />
      {/* Only drawing instructions and errors are announced; the legend changes with the year range and stays silent. */}
      <p className="fc-hint">
        <span role="status">{error || hint}</span>
        {!error && !hint && (layer === "activity"
          ? `Hexagons: raw fire-cell-days, any sensor, ${fromYear}–${toYear} (max ${fmt(hexes.max)} per ~12,000 km² cell).`
          : `Hexagons: ${layer === "viirs-only" ? "VIIRS-only" : layer === "modis-only" ? "MODIS-only" : "both-sensor"} share of each ~12,000 km² cell's fire-cell-days, ${Math.max(2012, fromYear)}–${toYear} (dark 0% to yellow 100%; cells under 20 cell-days hidden). The map counts whole calendar years, so it cannot drop outage months. The monthly, day/night and seasonal comparisons in the atlas panel do exclude them.`)}
        {!error && !hint && points && points.length > 0 && ` Ringed dots: published origin points of ${points.map((p) => p.label).join(", ")} (CAL FIRE); not perimeters.`}
      </p>
    </div>
  );
}
