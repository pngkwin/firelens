// Evidence-backed regional brief: a concise historical monitoring summary built
// only from the statistics the app already computes (no new analytics).
import type { MonthResult } from "./series";
import type { Calibration } from "./bundle";
import type { FireEvent } from "./events";
import { rankEvents } from "./events";
import { annualTotals, climatology, compareFocus, monthAnomalies, monthStatus, rankMonths, TREND_MAX_LOSS } from "./analysis";
import { atlasSummary, shares } from "./disagreement";
import { trendReadings } from "./transition";
import { METHOD_VERSION } from "./harmonize";
import { analyzeSeason, MONTH_NAMES as SEASON_MONTHS } from "./season";
import type { Incident } from "./incidents";
import { isPartial } from "./analysis";

export type BriefInput = {
  regionName: string; areaName: string; aoiEncoded: string; cellRule: string; boundary: string;
  months: MonthResult[]; from: string; to: string; focus: string | null; dataEnd: string;
  cal: Calibration; calSha: string; manifestSha: string; filesUsed: number; events: FireEvent[] | null; url: string; isSubArea: boolean;
  /** Documented incidents whose reference area is the current selection (src/data/v2/incidents.ts). */
  incidents?: Incident[];
};
export type Brief = ReturnType<typeof buildBrief>;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildBrief(b: BriefInput) {
  const inRange = b.months.filter((r) => r.month >= b.from && r.month <= b.to);
  const peaks = rankMonths(inRange, "modis-eq", 5);
  const years = annualTotals(inRange, "modis-eq").filter((a) => !a.partial && a.missingShare <= TREND_MAX_LOSS).sort((x, y) => y.value - x.value).slice(0, 3);
  const clim = climatology(inRange, "modis-eq");
  const totalMedian = clim.reduce((s, c) => s + (c.median ?? 0), 0);
  const season = [...clim].filter((c) => c.median != null).sort((x, y) => y.median! - x.median!).slice(0, 3).map((c) => ({ month: MONTHS[c.moy - 1], median: c.median!, share: totalMedian > 0 ? c.median! / totalMedian : 0 }));
  const anomalies = monthAnomalies(b.months, "modis-eq");
  const unusual = inRange
    .map((r) => ({ r, a: anomalies.get(r.month) ?? null }))
    .filter((x): x is { r: MonthResult; a: NonNullable<typeof x.a> } => !!x.a && (x.a.percentile >= 90 || x.a.percentile <= 10) && x.r.value != null)
    .map(({ r, a }) => ({ month: r.month, value: r.value!, lo: r.cls === "modis-observed" ? null : r.lo, hi: r.cls === "modis-observed" ? null : r.hi, pctOfMedian: a.pctOfMedian, percentile: a.percentile, high: a.percentile >= 90, intervalClear: r.cls === "modis-observed" || (a.percentile >= 90 ? (r.lo ?? 0) > a.median : (r.hi ?? 0) < a.median) }))
    .sort((x, y) => Math.abs(y.percentile - 50) - Math.abs(x.percentile - 50) || (y.value - x.value))
    .slice(0, 8);
  const focus = b.focus ? compareFocus(b.months, null, b.focus, "modis-eq") : null;
  const ev = b.events ? rankEvents(b.events, "modis-eq", new Map(b.months.map((m) => [m.month, m])), b.dataEnd, 7) : null;
  const atlas = atlasSummary(b.months, b.from < "2012-01" ? "2012-01" : b.from, b.to);
  const trend = trendReadings(b.months, Math.max(2003, +b.from.slice(0, 4)), Math.min(2025, +b.to.slice(0, 4)));
  const reduced = inRange.filter((r) => monthStatus(r, "modis-eq").reduced).map((r) => ({ month: r.month, reasons: monthStatus(r, "modis-eq").reasons }));
  const estimated = inRange.filter((r) => r.cls !== "modis-observed").length;
  const seasonA = analyzeSeason(b.months);
  const ref = seasonA.profiles.find((p) => p.period.id === "p2") ?? seasonA.profiles[0] ?? null;
  const partialMonths = inRange.filter(isPartial).map((r) => ({ month: r.month, days: r.daysCovered, of: r.daysInMonth }));
  return {
    title: `FireLens regional brief: ${b.areaName}`,
    generated: new Date().toISOString().slice(0, 10),
    area: { region: b.regionName, name: b.areaName, aoi: b.aoiEncoded, boundary: b.boundary, cellRule: b.cellRule },
    period: { from: b.from, to: b.to, months: inRange.length, estimatedMonths: estimated, dataEnd: b.dataEnd },
    peaks, years, season, unusual, focus, atlas: { used: atlas.used, total: atlas.total, shares: shares(atlas.total), day: shares(atlas.day), night: shares(atlas.night) },
    seasonEvolution: { findings: seasonA.findings, profiles: seasonA.profiles.map((p) => ({ label: p.period.label, note: p.period.note, n: p.n, peak: SEASON_MONTHS[p.peakMonth], peakShare: p.peakShare, busiest: `${SEASON_MONTHS[p.peak3.start]}–${SEASON_MONTHS[(p.peak3.start + 2) % 12]}`, busiestShare: p.peak3.share })) },
    planning: ref ? { period: ref.period.label, busiest: `${SEASON_MONTHS[ref.peak3.start]}–${SEASON_MONTHS[(ref.peak3.start + 2) % 12]}`, share: ref.peak3.share, peak: SEASON_MONTHS[ref.peakMonth], quiet: SEASON_MONTHS[ref.shares.indexOf(Math.min(...ref.shares))] } : null,
    incidents: (b.incidents ?? []).map((i) => ({ name: i.name, place: i.place, start: i.start, end: i.end, size: i.size, months: i.months, source: i.source })),
    partialMonths,
    trend, reduced, episodes: ev ? { pastCount: ev.pastCount, largest: ev.largestPast.slice(0, 5), current: ev.current.slice(0, 3), cutoff: ev.cutoff } : null,
    uncertainty: { interval: b.cal.interval90, aoiFactor: b.isSubArea ? b.cal.aoiInterval?.factor ?? null : null, smallArea: b.isSubArea },
    provenance: { method: METHOD_VERSION, selected: b.cal.selection.selected, calibrationSha256: b.calSha, manifestSha256: b.manifestSha, filesUsed: b.filesUsed, url: b.url, coverageVersion: b.cal.coverage.version },
  };
}

const f = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const p = (v: number | null | undefined) => (v == null ? "–" : `${(100 * v).toFixed(0)}%`);
const ym = (m: string) => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

/** Markdown version of the brief (download). */
export function briefMarkdown(br: Brief): string {
  const L: string[] = [];
  L.push(`# ${br.title}`, "", `${br.area.region} · ${br.area.name} · ${ym(br.period.from)} – ${ym(br.period.to)} · data through ${br.period.dataEnd} · generated ${br.generated}`, "");
  L.push("Historical monitoring summary of satellite fire detections on the harmonized MODIS-equivalent scale (fire-cell-days: ~0.74 km² cells with at least one detection on a UTC day). It is not burned area, a count of individual fires, or a fire-risk forecast. A zero means no matching records, not that no fire occurred.", "");
  L.push("## Peak burning months", ...br.peaks.map((t, i) => `${i + 1}. ${ym(t.key)}: ${f(t.value)}${t.lo != null ? ` (90% interval ${f(t.lo)}–${f(t.hi)}, estimated)` : " (observed MODIS)"}${t.reduced ? " — reduced satellite coverage, lower bound" : ""}`), "");
  if (br.years.length) L.push("Peak complete years: " + br.years.map((y) => `${y.year} (${f(y.value)})`).join(", ") + ".", "");
  L.push("## Seasonal pattern", `Typical year (median by month): ${br.season.map((s) => `${s.month} ${f(s.median)} (${p(s.share)} of the typical annual total)`).join("; ")}.`, "");
  if (br.planning) L.push("## Planning context (historical pattern, not a forecast)", `In ${br.planning.period} (observed MODIS), ${p(br.planning.share)} of a typical year's detected burning fell in ${br.planning.busiest}, peaking in ${br.planning.peak}; the quietest month was ${br.planning.quiet}. This describes when satellites have historically detected burning in this area; it is not a fire-danger rating or a forecast, and local conditions, fuels and weather decide actual risk.`, "");
  L.push("## Fire season evolution", ...br.seasonEvolution.profiles.map((s) => `- ${s.label} (${s.note}, ${s.n} years): peak ${s.peak} (${p(s.peakShare)}), busiest three months ${s.busiest} (${p(s.busiestShare)})`), "", ...br.seasonEvolution.findings, "");
  L.push("## Unusual months in the selected period", br.unusual.length ? "" : "No month in the period is in the top or bottom 10% of its comparable years.");
  for (const u of br.unusual) L.push(`- ${ym(u.month)}: ${f(u.value)}, ${f(u.pctOfMedian)}% of the median, percentile ${f(u.percentile)} (${u.high ? "unusually high" : "unusually low"}${u.intervalClear ? "" : "; the 90% interval overlaps the median"})`);
  if (br.focus?.stats) L.push("", `Focus ${ym(br.focus.month)}: ${f(br.focus.value)}, ${f(br.focus.stats.pctOfMedian)}% of the median of ${br.focus.stats.n} comparable years, percentile ${f(br.focus.stats.percentile)}.`);
  else if (br.focus?.blocked) L.push("", `Focus ${ym(br.focus.month)}: ${br.focus.blocked}`);
  L.push("");
  if (br.episodes) {
    L.push("## Largest past fire episodes in the area", `${f(br.episodes.pastCount)} past episodes (touching cells burning within one day of each other).`);
    for (const e of br.episodes.largest) L.push(`- ${e.start} – ${e.end}: ${f(e.size)} fire-cell-days, ${e.days} days, peak ${e.peakDay}`);
    L.push("");
  }
  if (br.incidents.length) {
    L.push("## Documented fires in this area (independent records)", "Quoted from the linked agency or Copernicus sources; agency acreage is burned area and is not comparable with fire-cell-days.");
    for (const i of br.incidents) L.push(`- ${i.name}: ${i.place}; from ${i.start}${i.end ? ` to ${i.end}` : ""}${i.size ? `; ${i.size}` : ""}. Source: ${i.source.map((s) => `${s.publisher} <${s.url}>`).join("; ")}`);
    L.push("");
  }
  L.push("## Sensor disagreement and harmonization", br.atlas.shares ? `Of ${f(br.atlas.total.union)} fire-cell-days detected by either sensor in ${br.atlas.used} fully observed months, ${p(br.atlas.shares.viirsOnly)} were seen only by VIIRS, ${p(br.atlas.shares.both)} by both and ${p(br.atlas.shares.modisOnly)} only by MODIS (night: ${p(br.atlas.night?.viirsOnly)} VIIRS-only). Disagreement reflects resolution, sensitivity, overpass time and outages, not sensor error.` : "No months observed completely by both sensors in this period.");
  if (br.trend.naive && br.trend.harmonized) L.push("", `Trend ${br.trend.years[0]}–${br.trend.years[1]}: a naive MODIS→VIIRS splice gives ${f(br.trend.naive.pctPerDecade)}% per decade (p = ${br.trend.naive.p.toPrecision(2)}, not comparable across the 2012 switch); the harmonized series gives ${f(br.trend.harmonized.pctPerDecade)}% per decade (p = ${br.trend.harmonized.p.toPrecision(2)}).`);
  L.push("", "## Uncertainty and satellite coverage", `${br.period.estimatedMonths} of ${br.period.months} months are estimated (Terra-only before 2002-07, from VIIRS from 2022) with 90% intervals (region scale ×[${f(br.uncertainty.interval?.lo, 3)}, ${f(br.uncertainty.interval?.hi, 3)}]).${br.uncertainty.smallArea ? ` For areas smaller than the region the sampling term is widened ×${f(br.uncertainty.aoiFactor, 2)} (validated on ~600,000 km² zones, not on smaller areas).` : ""} Validation is against observed MODIS, not ground truth.`);
  L.push(br.reduced.length ? `Reduced satellite coverage (values are lower bounds, excluded from anomalies and trends): ${br.reduced.map((r) => `${ym(r.month)} (${r.reasons.join("; ")})`).join("; ")}.` : "No month in the period has reduced satellite coverage.");
  if (br.partialMonths.length) L.push(`Incomplete month${br.partialMonths.length > 1 ? "s" : ""}: ${br.partialMonths.map((m) => `${ym(m.month)} (data for ${m.days} of ${m.of} days)`).join("; ")}. Incomplete months are never used as ordinary months in baselines, anomalies, seasonal profiles or trends.`);
  L.push("", "## Scope", "FireLens holds the complete record from November 2000 for two supported regions, the United States (contiguous, Alaska, Hawaii) and the Iberian Peninsula. It is not a global historical database.");
  L.push("", "## Sources and provenance", `- NASA FIRMS MODIS C6.1 (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20, NOAA-21); science-quality archive, near-real-time after.`, `- Area: ${br.area.aoi || "whole region"}; boundary ${br.area.boundary}; ${br.area.cellRule}.`, `- Method ${br.provenance.method} (${br.provenance.selected}), coverage audit ${br.provenance.coverageVersion}; calibration sha256 ${br.provenance.calibrationSha256}; bundle manifest sha256 ${br.provenance.manifestSha256}; ${br.provenance.filesUsed} verified bundle files.`, `- Explore: ${br.provenance.url}`);
  return L.join("\n") + "\n";
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Inline links: bare https URLs and <https://...> become anchors (after escaping). */
const linkify = (t: string) => esc(t).replace(/&lt;(https:\/\/[^\s&]+)&gt;|(https:\/\/[^\s<);]+)/g, (_, a, b) => { const u = a ?? b; return `<a href="${u}">${u}</a>`; });
/**
 * Self-contained HTML version of the brief (download), styled for reading and
 * printing to PDF. Built from the same Markdown, so both versions say the same.
 */
export function briefHtml(br: Brief): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of briefMarkdown(br).split("\n")) {
    if (line.startsWith("# ")) { close(); out.push(`<h1>${esc(line.slice(2))}</h1>`); }
    else if (line.startsWith("## ")) { close(); out.push(`<h2>${esc(line.slice(3))}</h2>`); }
    else if (/^- /.test(line)) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${linkify(line.slice(2))}</li>`); }
    else if (/^\d+\. /.test(line)) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${linkify(line.replace(/^\d+\. /, ""))}</li>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${linkify(line)}</p>`); }
  }
  close();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(br.title)}</title>
<style>body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#17231f;background:#fff;max-width:780px;margin:32px auto;padding:0 20px}h1{font-size:1.6rem;margin:0 0 4px;color:#173e36}h2{font-size:1.08rem;margin:1.6em 0 .4em;padding-top:.6em;border-top:1px solid #d9e2dc;color:#173e36}p,li{margin:.3em 0}ul,ol{padding-left:1.3em}a{color:#1f5f8b;word-break:break-all}h1+p{color:#4b5b55}@media print{body{margin:0;max-width:none;font-size:11pt}h2{break-after:avoid}li{break-inside:avoid}}</style></head><body>
${out.join("\n")}
<p style="color:#4b5b55;font-size:.85em;margin-top:2em">Generated by FireLens from NASA FIRMS data. Fire-cell-days are satellite detections, not burned area or fire counts.</p>
</body></html>
`;
}
