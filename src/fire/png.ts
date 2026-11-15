// PNG of the years x months calendar with legend and provenance footnote.
import type { MonthResult } from "../data/v2/series";
import { isEstimated, isPartial, monthValue, SCALES, type Scale } from "../data/v2/analysis";
import { fmt, MONTH_ABBR, sequential, sequentialTicks } from "./colors";

export function calendarPng(o: { months: MonthResult[]; scale: Scale; from: string; to: string; title: string; footer: string[] }): Promise<Blob> {
  const rows = o.months.filter((r) => r.month >= o.from && r.month <= o.to);
  const y0 = +o.from.slice(0, 4), y1 = +o.to.slice(0, 4), years = y1 - y0 + 1;
  const CW = 54, CH = 20, LEFT = 60, TOP = 76, W = LEFT + 12 * CW + 24, H = TOP + years * CH + 60 + o.footer.length * 16;
  const c = document.createElement("canvas");
  c.width = W * 2; c.height = H * 2;
  const g = c.getContext("2d")!;
  g.scale(2, 2);
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  const max = Math.max(1, ...rows.map((r) => monthValue(r, o.scale) ?? 0)), color = sequential(max);
  g.fillStyle = "#173e36"; g.font = "600 16px 'Source Sans 3', sans-serif"; g.fillText(o.title, 16, 24);
  g.font = "12px 'Source Sans 3', sans-serif"; g.fillStyle = "#586c64";
  g.fillText(`${SCALES[o.scale].label}, fire-cell-days per month. Dotted outline = estimated; ◢ = partial month.`, 16, 42);
  MONTH_ABBR.forEach((m, i) => g.fillText(m, LEFT + i * CW + 16, TOP - 8));
  const by = new Map(rows.map((r) => [r.month, r]));
  for (let y = y0; y <= y1; y++) {
    const row = y - y0;
    g.fillStyle = "#203c34"; g.fillText(String(y), 16, TOP + row * CH + 14);
    for (let m = 1; m <= 12; m++) {
      const r = by.get(`${y}-${String(m).padStart(2, "0")}`);
      if (!r) continue;
      const x = LEFT + (m - 1) * CW, yy = TOP + row * CH;
      g.fillStyle = color(monthValue(r, o.scale)); g.fillRect(x, yy, CW - 2, CH - 2);
      if (isEstimated(r, o.scale)) { g.setLineDash([2, 2]); g.strokeStyle = "#132a24"; g.strokeRect(x + 1, yy + 1, CW - 4, CH - 4); g.setLineDash([]); }
      if (isPartial(r)) { g.fillStyle = "#132a24"; g.beginPath(); g.moveTo(x + CW - 2, yy + CH - 9); g.lineTo(x + CW - 2, yy + CH - 2); g.lineTo(x + CW - 9, yy + CH - 2); g.fill(); }
    }
  }
  let lx = 16; const ly = TOP + years * CH + 18;
  g.fillStyle = "#203c34"; g.fillText("0 = no matching records", lx, ly + 10); lx += 140;
  for (const t of sequentialTicks(max).slice(1)) { g.fillStyle = color(t); g.fillRect(lx, ly, 14, 12); g.fillStyle = "#203c34"; g.fillText(fmt(t), lx + 18, ly + 10); lx += 70; }
  g.fillStyle = "#586c64";
  o.footer.forEach((t, i) => g.fillText(t, 16, ly + 34 + i * 16));
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(Error("PNG encoding failed"))), "image/png"));
}

export function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
