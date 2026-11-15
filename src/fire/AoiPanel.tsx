import { useState, type FormEvent } from "react";
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
  const [err, setErr] = useState("");
  const apply = (encoded: string) => {
    const r = decodeAoi(encoded);
    if (!r.ok) return setErr(r.error);
    setErr("");
    onAoi(r.aoi);
  };
  const submitBbox = (e: FormEvent) => { e.preventDefault(); apply(`bbox:${bbox.w},${bbox.s},${bbox.e},${bbox.n}`); };
  const submitPt = (e: FormEvent) => { e.preventDefault(); apply(`circle:${pt.lon},${pt.lat},${pt.km}`); };
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
              <input inputMode="decimal" value={bbox[k]} onChange={(e) => setBbox({ ...bbox, [k]: e.target.value })} required />
            </label>
          ))}
          <button className="button small primary" type="submit">Apply box</button>
        </form>
      </details>
      <details className="fc-details">
        <summary>Point and radius</summary>
        <form onSubmit={submitPt} className="fc-form" aria-label="Point and radius">
          <label className="fc-field small">Latitude<input inputMode="decimal" value={pt.lat} onChange={(e) => setPt({ ...pt, lat: e.target.value })} required /></label>
          <label className="fc-field small">Longitude<input inputMode="decimal" value={pt.lon} onChange={(e) => setPt({ ...pt, lon: e.target.value })} required /></label>
          <label className="fc-field small">Radius (km)<input inputMode="decimal" value={pt.km} onChange={(e) => setPt({ ...pt, km: e.target.value })} required max={MAX_RADIUS_KM} /></label>
          <button className="button small primary" type="submit">Apply circle</button>
        </form>
      </details>
      {err && <p className="fc-error" role="alert">{err}</p>}
      <p className="fc-note">An area includes every ~250 km² H3 cell whose centre lies inside it; region totals are clipped to the {region === "us" ? "US Census" : "Natural Earth"} boundary.</p>
    </section>
  );
}
