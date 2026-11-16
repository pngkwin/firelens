import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { DayResult } from "../data/v2/series";
import { dayValue, SCALES, type Scale } from "../data/v2/analysis";
import { fmt, MONTH_ABBR, OUT_OF_PERIOD_HATCH, sequential, ZERO_FILL } from "./colors";
import { doyLabel, type DayCheck, type Period } from "../data/v2/earlyWarning";

type Props = { days: DayResult[] | null; scale: Scale; obs?: DayCheck; from: string; to: string; progress: string; coverStart: string; dataEnd: string; periods: Period[] };
const CELL_W = 3, CELL_H = 14, LEFT = 44, TOP = 26;
const doy = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${d.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000);

/** Years x day-of-year raster (canvas) with an accessible per-year summary table. */
export function DoyHeatmap({ days, scale, obs, from, to, progress, coverStart, dataEnd, periods }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string>("");
  const [cursor, setCursor] = useState<string | null>(null); // keyboard day cursor (YYYY-MM-DD)
  const [announce, setAnnounce] = useState(false); // live only while navigating by keyboard
  const inRange = useMemo(() => (days ?? []).filter((d) => d.day.slice(0, 7) >= from && d.day.slice(0, 7) <= to), [days, from, to]);
  const years = useMemo(() => { const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4); return Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i); }, [from, to]);
  const max = Math.max(1, ...inRange.map((d) => dayValue(d, scale) ?? 0));
  const byKey = useMemo(() => new Map(inRange.map((d) => [d.day, d])), [inRange]);
  const summary = useMemo(() => years.map((y) => {
    let best: DayResult | null = null, bestV = -1, n = 0;
    for (const d of inRange) if (+d.day.slice(0, 4) === y) { const v = dayValue(d, scale) ?? 0; if (v > 0) n++; if (v > bestV) { bestV = v; best = d; } }
    return { year: y, peakDay: best?.day ?? null, peak: bestV < 0 ? null : bestV, activeDays: n };
  }), [years, inRange, scale]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const color = sequential(max);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = "11px 'Source Sans 3', sans-serif";
    ctx.fillStyle = "#586c64";
    MONTH_ABBR.forEach((m, i) => ctx.fillText(m, LEFT + doy(`2001-${String(i + 1).padStart(2, "0")}-01`) * CELL_W, 12));
    // Critical-period band (climatology), drawn above the first year.
    ctx.fillStyle = "#b54c20";
    for (const p of periods) {
      const segs = p.start <= p.end ? [[p.start, p.end]] : [[p.start, 364], [0, p.end]];
      for (const [a, b] of segs) ctx.fillRect(LEFT + a * CELL_W, 16, (b - a + 1) * CELL_W, 5);
    }
    // Covered days without any record are zeros ("no matching records"), not gaps.
    const lo = coverStart > `${from}-01` ? coverStart : `${from}-01`;
    const hi = dataEnd;
    ctx.fillStyle = ZERO_FILL;
    for (let t = Date.parse(`${lo}T00:00:00Z`), end = Date.parse(`${hi}T00:00:00Z`); t <= end; t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (d.slice(0, 7) > to) break;
      const row = +d.slice(0, 4) - years[0];
      if (!byKey.has(d) && (obs?.(d).observed ?? true)) ctx.fillRect(LEFT + doy(d) * CELL_W, TOP + row * CELL_H, CELL_W, CELL_H - 2);
    }
    // Outside the loaded period: hatched, so it differs from zero days by more than colour.
    const pattern = hatch(ctx);
    const first = lo, last = dataEnd < lastDayOf(to) ? dataEnd : lastDayOf(to);
    years.forEach((y, row) => {
      for (let col = 0; col < 366; col++) {
        const d = new Date(Date.UTC(y, 0, 1 + col)).toISOString().slice(0, 10);
        if (+d.slice(0, 4) !== y || (d >= first && d <= last && (obs?.(d).observed ?? true))) continue; // outside the period, or not observed (pre-launch, outage)
        if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(LEFT + col * CELL_W, TOP + row * CELL_H, CELL_W, CELL_H - 2); }
      }
    });
    years.forEach((y, row) => {
      ctx.fillStyle = "#203c34";
      ctx.fillText(String(y), 4, TOP + row * CELL_H + 11);
      for (const d of inRange) {
        if (+d.day.slice(0, 4) !== y || !(obs?.(d.day).observed ?? true)) continue;
        ctx.fillStyle = color(dayValue(d, scale));
        ctx.fillRect(LEFT + doy(d.day) * CELL_W, TOP + row * CELL_H, CELL_W, CELL_H - 2);
      }
    });
    // Reduced coverage (a satellite of the scale not observing): dark tick on top of the day.
    if (obs) {
      ctx.fillStyle = "#132a24";
      for (let t = Date.parse(`${lo}T00:00:00Z`), end = Date.parse(`${hi}T00:00:00Z`); t <= end; t += 86_400_000) {
        const d = new Date(t).toISOString().slice(0, 10);
        if (d.slice(0, 7) > to) break;
        const o = obs(d);
        if (o.observed && o.reduced) ctx.fillRect(LEFT + doy(d) * CELL_W, TOP + (+d.slice(0, 4) - years[0]) * CELL_H, CELL_W, 3);
      }
    }
    if (cursor) {
      const row = +cursor.slice(0, 4) - years[0];
      const x = LEFT + doy(cursor) * CELL_W, yy = TOP + row * CELL_H;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff"; ctx.strokeRect(x - 2, yy - 2, CELL_W + 4, CELL_H + 2);
      ctx.strokeStyle = "#132a24"; ctx.strokeRect(x - 4, yy - 4, CELL_W + 8, CELL_H + 6);
    }
  }, [inRange, years, scale, max, byKey, coverStart, dataEnd, from, to, periods, cursor, obs]);

  const describe = (day: string) => {
    const d = byKey.get(day);
    const inPeriod = day >= coverStart && day <= dataEnd;
    const o = inPeriod ? obs?.(day) : undefined;
    if (o && !o.observed) return `${day}: no observation (${o.reasons.join("; ")}), not zero`;
    return `${day}: ${d ? fmt(dayValue(d, scale), 1) : inPeriod ? "0 (no matching records)" : "outside the loaded period"}${d && d.cls !== "modis-observed" && SCALES[scale].harmonized ? " (estimated)" : ""}${o?.reduced ? `; reduced coverage: ${o.reasons.join("; ")}` : ""}`;
  };
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const start = cursor ?? (dataEnd.slice(0, 7) <= to ? dataEnd : lastDayOf(to));
    const t = Date.parse(`${start}T00:00:00Z`), y = +start.slice(0, 4);
    const sameDayIn = (yr: number) => new Date(Date.UTC(yr, 0, 1 + doy(start))).toISOString().slice(0, 10);
    const steps: Record<string, () => string> = {
      ArrowLeft: () => iso(t - 86_400_000), ArrowRight: () => iso(t + 86_400_000),
      ArrowUp: () => sameDayIn(y - 1), ArrowDown: () => sameDayIn(y + 1),
      PageUp: () => iso(t - 30 * 86_400_000), PageDown: () => iso(t + 30 * 86_400_000),
      Home: () => `${y}-01-01`, End: () => `${y}-12-31`,
    };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    let next = cursor ? step() : start;
    if (+next.slice(0, 4) < years[0]) next = `${years[0]}-01-01`;
    if (+next.slice(0, 4) > years.at(-1)!) next = `${years.at(-1)}-12-31`;
    setCursor(next); setAnnounce(true); setHover(describe(next));
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * e.currentTarget.width) / rect.width, y = ((e.clientY - rect.top) * e.currentTarget.height) / rect.height;
    const row = Math.floor((y - TOP) / CELL_H), col = Math.floor((x - LEFT) / CELL_W);
    if (row < 0 || row >= years.length || col < 0 || col > 365) return setHover("");
    const day = new Date(Date.UTC(years[row], 0, 1 + col)).toISOString().slice(0, 10);
    if (+day.slice(0, 4) !== years[row]) return setHover("");
    setAnnounce(false);
    setHover(describe(day));
  };

  return (
    <section className="fc-panel" aria-labelledby="fc-doy-title">
      <div className="fc-panel-head">
        <h2 id="fc-doy-title">Day-of-year calendar</h2>
        <p className="fc-sub">{SCALES[scale].label}, {SCALES[scale].unit} per UTC day. Harmonized days distribute each month's estimate by the month's reference sensor.</p>
      </div>
      {!days ? (
        <p className="fc-loading" role="status">{progress || "Loading daily data…"}</p>
      ) : (
        <>
          <div className="fc-doy-scroll">
            <canvas ref={canvas} width={LEFT + 366 * CELL_W + 4} height={TOP + years.length * CELL_H} className="fc-doy" tabIndex={0}
              aria-roledescription="day-of-year chart"
              aria-label={`Daily ${SCALES[scale].unit} by year and day of year, ${years[0]}–${years.at(-1)}. Arrow keys move one day or one year, Page Up and Page Down 30 days; peak days are listed in the table below.`}
              onKeyDown={onKey} onBlur={() => { setAnnounce(false); setCursor(null); }}
              onMouseMove={onMove} onMouseLeave={() => { if (!announce) setHover(""); }} />
          </div>
          <p className="fc-hover" aria-live={announce ? "polite" : "off"}>{hover || "Hover a day, or focus the chart and use the arrow keys, for its value."}</p>
          <div className="fc-legend"><span className="fc-swatch" style={{ background: ZERO_FILL }} /> 0 = no matching records <span className="fc-tick"><span className="fc-swatch fc-hatch-key" />outside the loaded period, sensor not yet in orbit, or satellite outage (no observation)</span> <span className="fc-tick"><span className="fc-swatch fc-reduced-tick-key" />reduced coverage (one satellite not observing)</span> <span className="fc-tick">max {fmt(max, 1)} per day</span>{periods.length > 0 && <span className="fc-tick"><span className="fc-swatch" style={{ background: "#b54c20" }} />critical period: {periods.map((p) => `${doyLabel(p.start)} – ${doyLabel(p.end)}`).join("; ")}</span>}</div>
          <details className="fc-details">
            <summary>Peak day and active days per year (table)</summary>
            <table className="fc-table">
              <thead><tr><th scope="col">Year</th><th scope="col">Peak day</th><th scope="col">Peak value</th><th scope="col">Days with fire</th></tr></thead>
              <tbody>{summary.map((s) => <tr key={s.year}><td>{s.year}</td><td>{s.peakDay ?? "n/a"}</td><td className="num">{fmt(s.peak, 1)}</td><td className="num">{s.activeDays}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const lastDayOf = (month: string) => iso(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0));
function hatch(ctx: CanvasRenderingContext2D) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 6;
  const t = tile.getContext("2d");
  if (!t) return null;
  t.strokeStyle = OUT_OF_PERIOD_HATCH;
  t.lineWidth = 1.5;
  t.beginPath(); t.moveTo(0, 6); t.lineTo(6, 0); t.stroke();
  return ctx.createPattern(tile, "repeat");
}
