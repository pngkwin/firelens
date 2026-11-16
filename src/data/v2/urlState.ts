// Shareable view state in the URL query string.
//   ?r=us&aoi=preset:us-06&from=2012-01&to=2026-11&scale=modis-eq&focus=2026-11
import { decodeAoi, encodeAoi, type Aoi } from "./aoi";
import { isScale, type Scale } from "./analysis";

export const REGIONS = { us: "United States", iberia: "Iberian Peninsula" } as const;
export type RegionId = keyof typeof REGIONS;
export const isRegion = (s: unknown): s is RegionId => typeof s === "string" && s in REGIONS;

export const TAB_IDS = ["season", "atlas", "transition", "evidence", "context", "brief"] as const;
export const MAP_LAYERS = ["activity", "viirs-only", "both", "modis-only"] as const;
export type ViewState = { region: RegionId; aoi: Aoi; from: string | null; to: string | null; scale: Scale; focus: string | null; tab: (typeof TAB_IDS)[number]; map: (typeof MAP_LAYERS)[number] };
export const DEFAULT_STATE: ViewState = { region: "us", aoi: { kind: "region" }, from: null, to: null, scale: "modis-eq", focus: null, tab: "season", map: "activity" };

const MONTH = /^(19|20)\d\d-(0[1-9]|1[0-2])$/;

export function parseState(search: string): { state: ViewState; errors: string[] } {
  const q = new URLSearchParams(search);
  const errors: string[] = [];
  const state: ViewState = { ...DEFAULT_STATE };
  const r = q.get("r");
  if (r != null) { if (isRegion(r)) state.region = r; else errors.push(`Unknown region "${r}".`); }
  const aoi = decodeAoi(q.get("aoi"));
  if (aoi.ok) state.aoi = aoi.aoi; else errors.push(aoi.error);
  for (const k of ["from", "to", "focus"] as const) {
    const v = q.get(k);
    if (v == null) continue;
    if (MONTH.test(v)) state[k] = v; else errors.push(`${k} must be YYYY-MM.`);
  }
  if (state.from && state.to && state.from > state.to) { errors.push("from must not be after to."); state.from = state.to = null; }
  const s = q.get("scale");
  if (s != null) { if (isScale(s)) state.scale = s; else errors.push(`Unknown scale "${s}".`); }
  const t = q.get("tab");
  if (t != null) { if ((TAB_IDS as readonly string[]).includes(t)) state.tab = t as ViewState["tab"]; else errors.push(`Unknown tab "${t}".`); }
  const m = q.get("map");
  if (m != null) { if ((MAP_LAYERS as readonly string[]).includes(m)) state.map = m as ViewState["map"]; else errors.push(`Unknown map layer "${m}".`); }
  return { state, errors };
}

export function serializeState(s: ViewState): string {
  const q = new URLSearchParams();
  q.set("r", s.region);
  if (s.aoi.kind !== "region") q.set("aoi", encodeAoi(s.aoi));
  if (s.from) q.set("from", s.from);
  if (s.to) q.set("to", s.to);
  if (s.scale !== DEFAULT_STATE.scale) q.set("scale", s.scale);
  if (s.focus) q.set("focus", s.focus);
  if (s.tab !== DEFAULT_STATE.tab) q.set("tab", s.tab);
  if (s.map !== DEFAULT_STATE.map) q.set("map", s.map);
  return `?${q.toString().replaceAll("%3A", ":").replaceAll("%2C", ",").replaceAll("%3B", ";")}`;
}
