import { useState, type FormEvent } from "react";
import { encodeAoi, exportBoxes, makeAoiTest, type Aoi } from "../data/v2/aoi";
import { monthlyCsv, provenance, filterPointsCsv } from "../data/v2/exportsV2";
import { hotspotsCsvUrl, liveConfigured, EXPORT_MAX_DAYS } from "../data/v2/live";
import { monthAnomalies, SCALES, type Scale } from "../data/v2/analysis";
import type { RegionId } from "../data/v2/urlState";
import type { FireData } from "./useFireData";
import { calendarPng, download } from "./png";
import { fmt } from "./colors";

type Props = { data: FireData; region: RegionId; aoi: Aoi; aoiName: string; from: string; to: string; scale: Scale };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function ExportPanel({ data, region, aoi, aoiName, from, to, scale }: Props) {
  const end = data.dataEnd ?? "";
  const [pts, setPts] = useState({ start: addDays(end, -6), end, modis: true, viirs: true });
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `firelens_${region}_${slug(aoiName)}_${from}_${to}`;
  const inRange = data.months.filter((r) => r.month >= from && r.month <= to);

  const prov = () => provenance({
    region,
    aoi: { encoded: encodeAoi(aoi), label: aoiName, cellRule: "H3 res-5 cells whose centre lies inside the area; region totals clipped to the region boundary", geometry: data.polys },
    range: { from, to }, scale,
    manifestSha256: data.manifestSha!, manifestUrl: `/data/v2/${region}/manifest.json`, planEnd: data.manifest!.planEnd,
    calibrationSha256: data.calSha!, selection: data.cal!.selection, interval90: data.cal!.interval90, terraInterval90: data.cal!.terraInterval90, coverage: data.cal!.coverage,
    filesUsed: data.filesUsed,
    live: { configured: data.live.status.configured, days: data.live.days.map((d) => ({ day: d.day, fetchedAt: d.fetchedAt, provisional: d.provisional, sources: d.sources })) },
    zeroMeaning: data.manifest!.product.zeroMeaning, areaCaveat: data.manifest!.product.areaCaveat,
    url: window.location.href,
  });

  async function points(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const sensors = [pts.modis && "modis", pts.viirs && "viirs"].filter(Boolean) as Array<"modis" | "viirs">;
    if (!sensors.length) return setMsg({ text: "Choose at least one sensor.", error: true });
    if (pts.start > pts.end) return setMsg({ text: "Start must not be after end.", error: true });
    const span = Math.round((Date.parse(pts.end) - Date.parse(pts.start)) / 86_400_000) + 1;
    if (span > EXPORT_MAX_DAYS) return setMsg({ text: `At most ${EXPORT_MAX_DAYS} days per point export.`, error: true });
    // Areas across the antimeridian (Alaska's Aleutians) are requested as two boxes.
    const boxes = data.polys ? exportBoxes(data.polys) : [data.manifest!.region.boxes[0].bbox as [number, number, number, number]];
    if (!data.polys && data.manifest!.region.boxes.length > 1) return setMsg({ text: "Choose a smaller area (state, box, circle or polygon) for point exports.", error: true });
    const urls = boxes.map((bbox) => hotspotsCsvUrl({ bbox, start: pts.start, end: pts.end, sensors }));
    if (urls.some((u) => !u)) return setMsg({ text: "Point export needs the live backend (VITE_CONVEX_SITE_URL is not configured).", error: true });
    setBusy(true);
    try {
      let csv = "", rows = 0;
      const sources = new Set<string>();
      for (const url of urls as string[]) {
        const res = await fetch(url);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw Error(body.error ?? `HTTP ${res.status}`);
        }
        const text = await res.text();
        csv += csv ? text.slice(text.indexOf("\n") + 1) : text; // one header
        rows += Number(res.headers.get("X-FireLens-Rows") ?? 0);
        res.headers.get("X-FireLens-Sources")?.split(",").filter(Boolean).forEach((s) => sources.add(s));
      }
      const out = data.polys ? filterPointsCsv(csv, makeAoiTest(data.polys)) : { csv, kept: rows, total: rows };
      download(`firelens_points_${region}_${slug(aoiName)}_${pts.start}_${pts.end}.csv`, out.csv, "text/csv");
      setMsg({ text: `Downloaded ${fmt(out.kept)} detections inside the area (${fmt(out.total)} in its bounding box${boxes.length > 1 ? "es on both sides of 180°" : ""}; sources ${sources.size ? [...sources].join(",") : "?"}). Raw FIRMS records, not static-masked.` });
    } catch (err) {
      setMsg({ text: `Point export failed: ${err instanceof Error ? err.message : String(err)}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fc-panel fc-exports" aria-labelledby="fc-export-title">
      <h2 id="fc-export-title">Exports</h2>
      <div className="fc-row">
        <button type="button" className="button small" disabled={!inRange.length} onClick={() => download(`${base}_monthly.csv`, monthlyCsv(inRange, monthAnomalies(data.months, "modis-eq")), "text/csv")}>Harmonized monthly CSV</button>
        <button type="button" className="button small" disabled={!data.manifest} onClick={() => download(`${base}_provenance.json`, JSON.stringify(prov(), null, 2), "application/json")}>Provenance JSON</button>
        <button type="button" className="button small" disabled={!inRange.length} onClick={async () => download(`${base}_${scale}_calendar.png`, await calendarPng({ months: data.months, scale, from, to, title: `FireLens · ${aoiName}`, footer: [`${SCALES[scale].label}. Method ${data.cal?.method} (${data.cal?.selection.selected}); NASA FIRMS MODIS C6.1 + VIIRS 375 m.`, `Data through ${data.dataEnd}. Bundle manifest sha256 ${data.manifestSha?.slice(0, 16)}…  ${window.location.href.slice(0, 120)}`] }))}>Calendar PNG</button>
      </div>
      <form className="fc-form" onSubmit={points} aria-label="Hotspot points CSV">
        <span className="fc-form-title">Hotspot points (≤ {EXPORT_MAX_DAYS} days{liveConfigured() ? "" : ", backend not configured"})</span>
        <label className="fc-field small">From<input type="date" value={pts.start} min="2000-11-01" max={end} onChange={(e) => setPts({ ...pts, start: e.target.value })} required /></label>
        <label className="fc-field small">To<input type="date" value={pts.end} min="2000-11-01" max={end} onChange={(e) => setPts({ ...pts, end: e.target.value })} required /></label>
        <label className="fc-check"><input type="checkbox" checked={pts.modis} onChange={(e) => setPts({ ...pts, modis: e.target.checked })} />MODIS</label>
        <label className="fc-check"><input type="checkbox" checked={pts.viirs} onChange={(e) => setPts({ ...pts, viirs: e.target.checked })} />VIIRS</label>
        <button className="button small primary" type="submit" disabled={busy || !liveConfigured()}>{busy ? "Fetching…" : "Download points CSV"}</button>
      </form>
      {msg && <p className={msg.error ? "fc-error" : "fc-note"} role={msg.error ? "alert" : "status"}>{msg.text}</p>}
    </section>
  );
}
