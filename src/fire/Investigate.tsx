import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { CASES, type Case } from "../data/v2/casebook";
import { monthLabel } from "./colors";

export const TABS = [
  { id: "season", label: "1 · Fire season" },
  { id: "atlas", label: "2 · Sensor disagreement" },
  { id: "transition", label: "3 · Why harmonization matters" },
  { id: "evidence", label: "4 · Evidence lab" },
  { id: "context", label: "5 · Documented fires" },
  { id: "brief", label: "6 · Regional brief" },
] as const;
export type TabId = (typeof TABS)[number]["id"];
export const isTab = (s: unknown): s is TabId => TABS.some((t) => t.id === s);

type Props = { tab: TabId; onTab: (t: TabId) => void; onCase: (c: Case) => void; activeCase: string | null; children: ReactNode };

/** One investigation workflow under the calendar: casebook, then six linked steps as tabs. */
export function Investigate({ tab, onTab, onCase, activeCase, children }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onTab(TABS[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return (
    <section className="fc-investigate" aria-labelledby="fc-inv-title">
      <div className="fc-panel fc-casebook">
        <div className="fc-panel-head">
          <h2 id="fc-inv-title">Investigate: from a month to the evidence</h2>
          <p className="fc-sub">Pick an area and month above (a state, a country, or draw your own), then follow the steps: how the fire season is distributed and whether it has changed, where MODIS and VIIRS disagree, why a naive sensor switch misleads, what evidence supports the calibration, what independent fire records say about the same months, and a brief you can download. FireLens holds the complete record from November 2000 for its two supported regions (United States and Iberian Peninsula); it is not a global database. Or start from a research case:</p>
        </div>
        <div className="fc-case-grid">
          {CASES.map((c) => (
            <article key={c.id} className={`fc-case${activeCase === c.id ? " active" : ""}`} aria-labelledby={`case-${c.id}`}>
              <h3 id={`case-${c.id}`} className="fc-h3">{c.area}: {monthLabel(c.focus)}</h3>
              <p><strong>Question.</strong> {c.question}</p>
              <p><strong>Finding.</strong> {c.finding}</p>
              <details className="fc-details">
                <summary>Sensor comparison, limits and meaning</summary>
                <p><strong>Sensors.</strong> {c.sensors}</p>
                <p><strong>Limits.</strong> {c.limits}</p>
                <p><strong>What it means.</strong> {c.meaning}</p>
                <p className="fc-dim">Selection: {c.area} ({c.aoi.kind === "preset" ? `preset ${c.aoi.id}` : "whole region"}), {monthLabel(c.from)} – {monthLabel(c.to)}. Every number here is recomputed from the bundle by an automated test.</p>
              </details>
              <button type="button" className="button small" onClick={() => onCase(c)} aria-pressed={activeCase === c.id}>{activeCase === c.id ? "Case open: explore it below" : "Open this case"}</button>
            </article>
          ))}
        </div>
      </div>
      <div className="fc-tabs" role="tablist" aria-label="Investigation steps" ref={list} onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="fc-tabpanel" tabIndex={tab === t.id ? 0 : -1} className={`fc-tab${tab === t.id ? " active" : ""}`} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div id="fc-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>{children}</div>
    </section>
  );
}
