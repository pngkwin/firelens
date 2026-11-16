import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { MonthResult } from "../data/v2/series";
import { annualTotals, isEstimated, isPartial, monthInterval, monthStatus, monthValue, SCALES, type Scale } from "../data/v2/analysis";
import { fmt, MONTH_ABBR, monthLabel, sequential, sequentialTicks, textOn, ZERO_FILL } from "./colors";

type Props = { months: MonthResult[]; scale: Scale; from: string; to: string; focus: string | null; onFocus: (m: string) => void };

export function MonthHeatmap({ months, scale, from, to, focus, onFocus }: Props) {
  const inRange = useMemo(() => months.filter((r) => r.month >= from && r.month <= to), [months, from, to]);
  const byMonth = useMemo(() => new Map(inRange.map((r) => [r.month, r])), [inRange]);
  const years = useMemo(() => {
    const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
    return Array.from({ length: Math.max(0, y1 - y0 + 1) }, (_, i) => y0 + i);
  }, [from, to]);
  const annual = useMemo(() => new Map(annualTotals(inRange, scale).map((a) => [a.year, a])), [inRange, scale]);
  const max = Math.max(1, ...inRange.map((r) => monthValue(r, scale) ?? 0));
  const color = sequential(max);
  const ranks = useMemo(() => {
    const sorted = inRange.map((r) => [r.month, monthValue(r, scale) ?? -1] as const).sort((a, b) => b[1] - a[1]);
    return new Map(sorted.map(([m], i) => [m, i + 1]));
  }, [inRange, scale]);
  const [active, setActive] = useState<string | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  // Exactly one tab stop: the arrowed month, else the focus month, else the last month, as long as it is in range.
  const current = [active, focus].find((m): m is string => !!m && byMonth.has(m)) ?? inRange.at(-1)?.month ?? null;

  const move = (e: KeyboardEvent, month: string) => {
    const [y, m] = [+month.slice(0, 4), +month.slice(5, 7)];
    const d: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Home: [0, 1 - m], End: [0, 12 - m] };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    let ny = y + step[0], nm = m + step[1];
    if (nm < 1) { nm = 12; ny--; } else if (nm > 12) { nm = 1; ny++; }
    const next = `${ny}-${String(nm).padStart(2, "0")}`;
    if (!byMonth.has(next)) return;
    setActive(next);
    grid.current?.querySelector<HTMLButtonElement>(`[data-month="${next}"]`)?.focus();
  };

  const label = (r: MonthResult, shown: string) => {
    const v = monthValue(r, scale), iv = monthInterval(r, scale), st = monthStatus(r, scale);
    if (!st.available) return `${monthLabel(r.month)}: not observed (${st.reasons.join("; ")})`;
    // Starts with the visible text (WCAG 2.5.3 Label in Name).
    const parts = [`${shown ? `${shown}, ` : ""}${monthLabel(r.month)}: ${fmt(v)} ${SCALES[scale].short} ${SCALES[scale].unit}`];
    if (iv && iv[1] > 0) parts.push(`90% interval ${fmt(iv[0])}–${fmt(iv[1])}`);
    if (isEstimated(r, scale)) parts.push("estimated");
    if (isPartial(r)) parts.push(`partial month through day ${r.daysCovered}`);
    if (st.reduced) parts.push(`reduced satellite coverage: ${st.reasons.join("; ")}`);
    if (v === 0) parts.push("no matching records in loaded data");
    parts.push(`rank ${ranks.get(r.month)} of ${inRange.length}`);
    return parts.join(", ");
  };

  return (
    <section className="fc-panel" aria-labelledby="fc-calendar-title">
      <div className="fc-panel-head">
        <h2 id="fc-calendar-title">Burning-activity calendar</h2>
        <p className="fc-sub">{SCALES[scale].label}, {SCALES[scale].unit} per month. Select a month to compare it with other years.</p>
      </div>
      <div className="fc-heat-scroll">
        <table className="fc-heat" ref={grid} aria-label={`${SCALES[scale].unit} by year and month, ${SCALES[scale].label}`}>
          <thead>
            <tr>
              <th scope="col">Year</th>
              {MONTH_ABBR.map((m) => <th scope="col" key={m}>{m}</th>)}
              <th scope="col" className="fc-total-col">Year total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const a = annual.get(y);
              return (
                <tr key={y}>
                  <th scope="row">{y}</th>
                  {MONTH_ABBR.map((_, i) => {
                    const m = `${y}-${String(i + 1).padStart(2, "0")}`;
                    const r = byMonth.get(m);
                    if (!r) return <td key={m} className="fc-empty" aria-label={`${monthLabel(m)}: outside the loaded period`} />;
                    const v = monthValue(r, scale), fill = color(v), st = monthStatus(r, scale);
                    const shown = shortValue(v), name = label(r, shown);
                    return (
                      <td key={m}>
                        <button
                          type="button"
                          data-month={m}
                          tabIndex={current === m ? 0 : -1}
                          className={`fc-cell${isEstimated(r, scale) ? " est" : ""}${isPartial(r) ? " partial" : ""}${st.reduced ? " reduced" : ""}${st.available ? "" : " na"}${focus === m ? " focus" : ""}`}
                          style={{ background: fill, color: textOn(fill), "--mark": textOn(fill) } as CSSProperties}
                          aria-pressed={focus === m}
                          aria-label={name}
                          title={name}
                          onClick={() => { setActive(m); onFocus(m); }}
                          onKeyDown={(e) => move(e, m)}
                        >
                          {shown}
                        </button>
                      </td>
                    );
                  })}
                  <td className="fc-total-col">
                    {a ? <span title={a.partial ? "Partial year" : undefined}>{fmt(a.value)}{a.partial ? "*" : ""}</span> : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="fc-legend" role="group" aria-label={`Colour scale, ${SCALES[scale].short} ${SCALES[scale].unit} per month`}>
        <span className="fc-swatch" style={{ background: ZERO_FILL }} /> 0 = no matching records
        {sequentialTicks(max).slice(1).map((t) => (
          <span key={t} className="fc-tick"><span className="fc-swatch" style={{ background: color(t) }} />{fmt(t)}</span>
        ))}
        <span className="fc-tick"><span className="fc-swatch est-key" /> estimated</span>
        <span className="fc-tick"><span className="fc-swatch partial-key" /> partial month</span>
        <span className="fc-tick"><span className="fc-swatch reduced-key" /> reduced satellite coverage (outage)</span>
        {inRange.some((r) => !monthStatus(r, scale).available) && <span className="fc-tick"><span className="fc-swatch fc-hatch-key" /> sensor not yet in orbit (no value)</span>}
        <span className="fc-tick">* partial year</span>
      </div>
    </section>
  );
}

export const shortValue = (v: number | null | undefined) => (v == null ? "" : v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : fmt(v));
