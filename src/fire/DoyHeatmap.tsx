import { useEffect, useMemo, useRef, useState } from "react";
import type { DayResult } from "../data/v2/series";
import { dayValue, SCALES, type Scale } from "../data/v2/analysis";
import { fmt, MONTH_ABBR, sequential, ZERO_FILL } from "./colors";
import { doyLabel, type Period } from "../data/v2/earlyWarning";

type Props = { days: DayResult[] | null; scale: Scale; from: string; to: string; progress: string; coverStart: string; dataEnd: string; periods: Period[] };
const CELL_W = 3, CELL_H = 14, LEFT = 44, TOP = 26;
const doy = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${d.slice(0, 4)}-01-01T00:00:00Z`)) / 86_400_000);

/** Years x day-of-year raster (canvas) with an accessible per-year summary table. */
export function DoyHeatmap({ days, scale, from, to, progress, coverStart, dataEnd, periods }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string>("");
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
      if (!byKey.has(d)) ctx.fillRect(LEFT + doy(d) * CELL_W, TOP + row * CELL_H, CELL_W, CELL_H - 2);
    }
    years.forEach((y, row) => {
      ctx.fillStyle = "#203c34";
      ctx.fillText(String(y), 4, TOP + row * CELL_H + 11);
      for (const d of inRange) {
        if (+d.day.slice(0, 4) !== y) continue;
        ctx.fillStyle = color(dayValue(d, scale));
        ctx.fillRect(LEFT + doy(d.day) * CELL_W, TOP + row * CELL_H, CELL_W, CELL_H - 2);
      }
    });
  }, [inRange, years, scale, max, byKey, coverStart, dataEnd, from, to, periods]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * e.currentTarget.width) / rect.width, y = ((e.clientY - rect.top) * e.currentTarget.height) / rect.height;
    const row = Math.floor((y - TOP) / CELL_H), col = Math.floor((x - LEFT) / CELL_W);
    if (row < 0 || row >= years.length || col < 0 || col > 365) return setHover("");
    const day = new Date(Date.UTC(years[row], 0, 1 + col)).toISOString().slice(0, 10);
    if (+day.slice(0, 4) !== years[row]) return setHover("");
    const d = byKey.get(day);
    setHover(`${day}: ${d ? fmt(dayValue(d, scale), 1) : day >= coverStart && day <= dataEnd ? "0 (no matching records)" : "outside the loaded period"}${d && d.cls !== "modis-observed" && SCALES[scale].harmonized ? " (estimated)" : ""}`);
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
            <canvas ref={canvas} width={LEFT + 366 * CELL_W + 4} height={TOP + years.length * CELL_H} className="fc-doy" role="img"
              aria-label={`Daily ${SCALES[scale].unit} by year and day of year, ${years[0]}–${years.at(-1)}; peak days are listed in the table below`}
              onMouseMove={onMove} onMouseLeave={() => setHover("")} />
          </div>
          <p className="fc-hover" aria-live="off">{hover || "Hover a day for its value."}</p>
          <div className="fc-legend"><span className="fc-swatch" style={{ background: ZERO_FILL }} /> 0 = no matching records <span className="fc-tick">max {fmt(max, 1)} per day</span>{periods.length > 0 && <span className="fc-tick"><span className="fc-swatch" style={{ background: "#b54c20" }} />critical period: {periods.map((p) => `${doyLabel(p.start)} – ${doyLabel(p.end)}`).join("; ")}</span>}</div>
          <details className="fc-details">
            <summary>Peak day and active days per year (table)</summary>
            <table className="fc-table">
              <thead><tr><th scope="col">Year</th><th scope="col">Peak day</th><th scope="col">Peak value</th><th scope="col">Days with fire</th></tr></thead>
              <tbody>{summary.map((s) => <tr key={s.year}><td>{s.year}</td><td>{s.peakDay ?? "–"}</td><td className="num">{fmt(s.peak, 1)}</td><td className="num">{s.activeDays}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
