import { useId, useState, type FormEvent } from "react";
import { decodeAoi, MAX_RADIUS_KM, polysAreaKm2, type Aoi, type Polys } from "../data/v2/aoi";
import { REGIONS, type RegionId } from "../data/v2/urlState";
import type { Preset } from "./useFireData";
import { fmt } from "./colors";
import { SelectField } from "./SelectField";

type Props = { region: RegionId; onRegion: (r: RegionId) => void; aoi: Aoi; polys: Polys | null; presets: Preset[]; cellsInAoi: number; onAoi: (a: Aoi) => void };

export function aoiLabel(aoi: Aoi, presets: Preset[], region: RegionId) {
  switch (aoi.kind) {
    case "region": return `Whole region: ${REGIONS[region]}`;
    case "preset": return presets.find((p) => p.id === aoi.id)?.name ?? aoi.id;
    case "bbox": return `Box ${aoi.bbox.join(", ")}`;
    case "circle": return `${fmt(aoi.radiusKm, 1)} km around ${aoi.center[1]}, ${aoi.center[0]}`;
    case "polygon": return `Drawn polygon (${aoi.ring.length} vertices)`;
  }
}

export function AoiPanel({ region, onRegion, aoi, polys, presets, cellsInAoi, onAoi }: Props) {
  const [bbox, setBbox] = useState({ w: "", s: "", e: "", n: "" });
  const [pt, setPt] = useState({ lat: "", lon: "", km: "50" });
  const [vertices, setVertices] = useState("");
  // The error belongs to the form that produced it, so only that form's inputs are marked invalid.
  const [err, setErr] = useState<{ form: "bbox" | "circle" | "poly"; text: string } | null>(null);
  const errId = useId();
  const apply = (form: "bbox" | "circle" | "poly", encoded: string) => {
    const r = decodeAoi(encoded);
    if (!r.ok) return setErr({ form, text: r.error });
    setErr(null);
    onAoi(r.aoi);
  };
  const invalid = (form: "bbox" | "circle" | "poly") => (err?.form === form ? { "aria-invalid": true as const, "aria-describedby": errId } : {});
  const submitBbox = (e: FormEvent) => { e.preventDefault(); apply("bbox", `bbox:${bbox.w},${bbox.s},${bbox.e},${bbox.n}`); };
  const submitPt = (e: FormEvent) => { e.preventDefault(); apply("circle", `circle:${pt.lon},${pt.lat},${pt.km}`); };
  const submitPoly = (e: FormEvent) => { e.preventDefault(); apply("poly", `poly:${verticesToParam(vertices)}`); };
  return (
    <section className="fc-panel fc-aoi" aria-labelledby="fc-aoi-title">
      <h2 id="fc-aoi-title">Area of interest</h2>
      <SelectField label="Region" value={region} onChange={(v) => onRegion(v as RegionId)}>
        {Object.entries(REGIONS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </SelectField>
      <p className="fc-current" aria-live="polite">
        <strong>{aoiLabel(aoi, presets, region)}</strong>
        {polys && <> · ≈{fmt(polysAreaKm2(polys))} km² · {fmt(cellsInAoi)} res-5 cells with data</>}
      </p>
      <div className="fc-row">
        <button type="button" className="button small" onClick={() => onAoi({ kind: "region" })} disabled={aoi.kind === "region"}>Whole region</button>
        <SelectField className="inline" label={region === "us" ? "State" : "Country"} value={aoi.kind === "preset" ? aoi.id : ""} onChange={(v) => v && onAoi({ kind: "preset", id: v })}>
          <option value="">Choose…</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
      </div>
      <details className="fc-details">
        <summary>Bounding box</summary>
        <form onSubmit={submitBbox} className="fc-form" aria-label="Bounding box in decimal degrees">
          {(["w", "s", "e", "n"] as const).map((k) => (
            <label key={k} className="fc-field small">
              {{ w: "West", s: "South", e: "East", n: "North" }[k]}
              <input inputMode="decimal" value={bbox[k]} onChange={(e) => setBbox({ ...bbox, [k]: e.target.value })} required {...invalid("bbox")} />
            </label>
          ))}
          <button className="button small primary" type="submit">Apply box</button>
        </form>
      </details>
      <details className="fc-details">
        <summary>Point and radius</summary>
        <form onSubmit={submitPt} className="fc-form" aria-label="Point and radius">
          <label className="fc-field small">Latitude<input inputMode="decimal" value={pt.lat} onChange={(e) => setPt({ ...pt, lat: e.target.value })} required {...invalid("circle")} /></label>
          <label className="fc-field small">Longitude<input inputMode="decimal" value={pt.lon} onChange={(e) => setPt({ ...pt, lon: e.target.value })} required {...invalid("circle")} /></label>
          <label className="fc-field small">Radius (km, ≤ {fmt(MAX_RADIUS_KM)})<input inputMode="decimal" value={pt.km} onChange={(e) => setPt({ ...pt, km: e.target.value })} required {...invalid("circle")} /></label>
          <button className="button small primary" type="submit">Apply circle</button>
        </form>
      </details>
      <details className="fc-details">
        <summary>Polygon vertices</summary>
        <form onSubmit={submitPoly} className="fc-form" aria-label="Polygon vertices">
          <label className="fc-field">
            Vertices: one “longitude, latitude” pair per line, at least three
            <textarea rows={4} value={vertices} onChange={(e) => setVertices(e.target.value)} placeholder={"-122.5, 38.5\n-121.0, 38.5\n-121.0, 39.5\n-122.5, 39.5"} required spellCheck={false} {...invalid("poly")} />
          </label>
          <button className="button small primary" type="submit">Apply polygon</button>
        </form>
      </details>
      {err && <p className="fc-error" role="alert" id={errId}>{err.text}</p>}
      <p className="fc-note">An area includes every ~250 km² H3 cell whose centre lies inside it; region totals are clipped to the {region === "us" ? "US Census" : "Natural Earth"} boundary.</p>
    </section>
  );
}

/** "lon, lat" lines (or ";"-separated pairs) to the URL polygon form "lon,lat;lon,lat;…". */
export function verticesToParam(text: string): string {
  return text
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[\s,]+/).filter(Boolean).join(","))
    .join(";");
}
