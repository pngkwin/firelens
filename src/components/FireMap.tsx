import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as GLMap } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Crosshair, Scan, X, MapPin } from "lucide-react";
import { useStudy } from "../state/StudyContext";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type { Bounds } from "../data/types";
maplibregl.setWorkerUrl(mapWorkerUrl);
function regionFeature(
  b: Bounds | null,
): FeatureCollection<Polygon | MultiPolygon> {
  if (!b) return { type: "FeatureCollection", features: [] };
  const ring = (w: number, e: number) => [
    [w, b.south],
    [e, b.south],
    [e, b.north],
    [w, b.north],
    [w, b.south],
  ];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry:
          b.west <= b.east
            ? { type: "Polygon", coordinates: [ring(b.west, b.east)] }
            : {
                type: "MultiPolygon",
                coordinates: [[ring(b.west, 180)], [ring(-180, b.east)]],
              },
      },
    ],
  };
}
export function FireMap() {
  const {
    datasets,
    records,
    focused,
    selected,
    setSelectedId,
    filters,
    updateFilters,
  } = useStudy();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<GLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [corner, setCorner] = useState<[number, number] | null>(null);
  const current = useRef({ drawing, corner, updateFilters, setSelectedId });
  current.current = { drawing, corner, updateFilters, setSelectedId };
  const [page, setPage] = useState(0);
  const geojson = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: focused.map((r) => ({
        type: "Feature",
        properties: { id: r.id, sensor: r.sensor },
        geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
      })),
    }),
    [focused],
  );
  useEffect(() => {
    if (!container.current) return;
    let instance: GLMap;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        center: [0, 20],
        zoom: 1.4,
        style: "https://tiles.openfreemap.org/styles/positron",
        attributionControl: { compact: true },
      });
    } catch {
      setError(
        "WebGL is unavailable. Use the observation table below to inspect records.",
      );
      return;
    }
    map.current = instance;
    instance.on("idle", () => setRendering(false));
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    instance.on("error", () => {
      setError(
        "Some map tiles could not load. Check your connection; records remain available below.",
      );
    });
    instance.on("load", () => {
      instance.addSource("observations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 35,
      });
      instance.addLayer({
        id: "clusters",
        type: "circle",
        source: "observations",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#285c50",
          "circle-radius": [
            "step",
            ["get", "point_count"],
            17,
            100,
            23,
            1000,
            29,
            10000,
            33,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.96,
        },
      });
      instance.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "observations",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["to-string", ["get", "point_count"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#ffffff" },
      });
      instance.on("mouseenter", "clusters", () => {
        if (!current.current.drawing)
          instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "clusters", () => {
        instance.getCanvas().style.cursor = current.current.drawing
          ? "crosshair"
          : "";
      });
      instance.addLayer({
        id: "hotspots",
        type: "circle",
        source: "observations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "sensor"],
            "MODIS",
            "#b54c20",
            "#2d7191",
          ],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 12, 5],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.8,
          "circle-opacity": 0.9,
        },
      });
      instance.addSource("region", {
        type: "geojson",
        data: regionFeature(null),
      });
      instance.addLayer({
        id: "region-fill",
        type: "fill",
        source: "region",
        paint: { "fill-color": "#275b49", "fill-opacity": 0.08 },
      });
      instance.addLayer({
        id: "region-line",
        type: "line",
        source: "region",
        paint: {
          "line-color": "#173e36",
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
      });
      setReady(true);
    });
    instance.on("click", async (event) => {
      const state = current.current;
      if (state.drawing) {
        if (!state.corner) setCorner([event.lngLat.lng, event.lngLat.lat]);
        else {
          const [lng, lat] = state.corner;
          const w = Math.min(lng, event.lngLat.lng),
            e = Math.max(lng, event.lngLat.lng),
            s = Math.min(lat, event.lngLat.lat),
            n = Math.max(lat, event.lngLat.lat);
          if (w !== e && s !== n) {
            state.updateFilters({
              bounds: { west: w, east: e, south: s, north: n },
            });
            setDrawing(false);
            setCorner(null);
          }
        }
        return;
      }
      if (!instance.getLayer("hotspots")) return;
      const features = instance.queryRenderedFeatures(event.point, {
        layers: ["hotspots", "clusters", "cluster-count"],
      });
      const f = features[0];
      if (f?.properties?.cluster_id !== undefined) {
        const source = instance.getSource("observations") as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(
          Number(f.properties.cluster_id),
        );
        if (f.geometry.type === "Point")
          instance.easeTo({
            center: f.geometry.coordinates as [number, number],
            zoom,
            duration: 0,
          });
      } else if (f?.properties?.id)
        state.setSelectedId(String(f.properties.id));
    });
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (ready) {
      setRendering(true);
      (map.current?.getSource("observations") as GeoJSONSource)?.setData(
        geojson,
      );
    }
    setPage(0);
  }, [geojson, ready]);
  useEffect(() => {
    if (ready) {
      setRendering(true);
      (map.current?.getSource("region") as GeoJSONSource)?.setData(
        regionFeature(filters.bounds),
      );
    }
  }, [filters.bounds, ready]);
  const fit = () => {
    if (!map.current) return;
    if (filters.bounds) {
      const b = filters.bounds;
      map.current.fitBounds(
        [
          [b.west, b.south],
          [b.east < b.west ? b.east + 360 : b.east, b.north],
        ],
        { padding: 40, maxZoom: 12, duration: 0 },
      );
      return;
    }
    if (!records.length) return;
    const b = new maplibregl.LngLatBounds();
    for (const r of records) b.extend([r.longitude, r.latitude]);
    map.current.fitBounds(b, { padding: 40, maxZoom: 12, duration: 0 });
  };
  useEffect(() => {
    if (ready && records.length) fit();
  }, [ready, records]);
  useEffect(() => {
    if (map.current)
      map.current.getCanvas().style.cursor = drawing ? "crosshair" : "";
  }, [drawing]);
  return (
    <section className="map-panel" aria-labelledby="map-title">
      <div className="section-heading">
        <div>
          <h2 id="map-title">Geographic observations</h2>
          <p>
            {focused.length.toLocaleString()} records in focus ·{" "}
            {filters.bounds ? "Selected region" : "All loaded locations"}
          </p>
        </div>
        <MapPin size={18} className="muted-icon" />
      </div>
      <div className="map-tools">
        <button
          className={`button small ${drawing ? "primary" : ""}`}
          onClick={() => {
            setDrawing((v) => !v);
            setCorner(null);
          }}
          disabled={!ready}
        >
          <Scan size={14} />
          {drawing ? "Cancel drawing" : "Draw region"}
        </button>
        <button
          className="button small"
          onClick={fit}
          disabled={!ready || !records.length}
        >
          <Crosshair size={14} />
          Fit extent
        </button>
        <span className="map-sensor-key">
          <i className="sensor-dot modis" />
          MODIS <i className="sensor-dot viirs" />
          VIIRS
        </span>
      </div>
      <div className="map-canvas-wrap">
        <div
          ref={container}
          className="map-canvas"
          aria-busy={!ready || rendering}
          role="region"
          aria-label="Interactive map of imported NASA FIRMS observations"
        />
        {!error && !drawing && (!ready || rendering) && records.length > 0 && (
          <div className="map-guidance" role="status">
            Updating map observations…
          </div>
        )}
        {drawing && (
          <div className="map-guidance" role="status">
            {corner
              ? "Select the opposite corner to apply the region."
              : "Select the first corner of a bounding box."}
          </div>
        )}
        {!records.length && (
          <div className="map-empty">
            <strong>A place to begin your research</strong>
            <p>
              Import NASA FIRMS records to locate observations and define your
              study area.
            </p>
          </div>
        )}
        {records.length > 0 && !focused.length && (
          <div className="map-guidance">
            No matching observations. Adjust the region, dates, sensor, or
            selected month.
          </div>
        )}
      </div>
      <div className="map-bottom">
        <span>
          Numbered circles = grouped records. Select a cluster to zoom; select a
          hotspot to inspect.
        </span>
        <span>Acquisition times in UTC</span>
      </div>
      {error && (
        <p role="status" className="map-error">
          {error}
        </p>
      )}
      {selected && (
        <div className="hotspot-inspector">
          <div className="section-heading">
            <h3>
              {selected.sensor} · {selected.satellite}
            </h3>
            <button
              className="icon-button"
              onClick={() => setSelectedId(null)}
              aria-label="Close hotspot details"
            >
              <X size={16} />
            </button>
          </div>
          <dl>
            <div>
              <dt>Acquired UTC</dt>
              <dd>
                {selected.date} {selected.time.slice(0, 2)}:
                {selected.time.slice(2)}
              </dd>
            </div>
            <div>
              <dt>Coordinates</dt>
              <dd>
                {selected.latitude}, {selected.longitude}
              </dd>
            </div>
            <div>
              <dt>Confidence (source)</dt>
              <dd>
                {selected.confidence}
                {selected.sensor === "VIIRS" &&
                (
                  { l: "low", n: "nominal", h: "high" } as Record<
                    string,
                    string
                  >
                )[selected.confidence.toLowerCase()]
                  ? ` (${{ l: "low", n: "nominal", h: "high" }[selected.confidence.toLowerCase() as "l" | "n" | "h"]} · VIIRS)`
                  : selected.sensor === "MODIS"
                    ? " (MODIS source scale)"
                    : ""}
              </dd>
            </div>
            <div>
              <dt>FRP</dt>
              <dd>
                {selected.frp === undefined
                  ? "Not supplied"
                  : `${selected.frp} MW`}
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{selected.version}</dd>
            </div>
            <div>
              <dt>Source instrument / platform</dt>
              <dd>
                {selected.sourceInstrument} / {selected.sourceSatellite}
              </dd>
            </div>
            <div>
              <dt>Day / night (source)</dt>
              <dd>{selected.daynight}</dd>
            </div>
            <div>
              <dt>Source file</dt>
              <dd>
                {datasets.find((d) => d.id === selected.datasetId)?.name ??
                  "Unknown source"}
              </dd>
            </div>
            {Object.entries(selected.thermal).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {value}{" "}
                  {key === "scan" || key === "track"
                    ? "km"
                    : key === "type"
                      ? "(source code)"
                      : "K"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <details className="data-table-details">
        <summary>Inspect observations in an accessible table</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>UTC date / time</th>
                <th>Sensor / platform</th>
                <th>Coordinates</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {focused.slice(page * 25, page * 25 + 25).map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.date} {r.time.slice(0, 2)}:{r.time.slice(2)}
                  </td>
                  <td>
                    {r.sensor} / {r.satellite}
                  </td>
                  <td>
                    {r.latitude}, {r.longitude}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setSelectedId(r.id)}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <button
            className="button small"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            {focused.length
              ? `${page * 25 + 1}–${Math.min(focused.length, page * 25 + 25)} of ${focused.length.toLocaleString()}`
              : "No records"}
          </span>
          <button
            className="button small"
            disabled={(page + 1) * 25 >= focused.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </details>
    </section>
  );
}
