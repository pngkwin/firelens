// Colour-vision-deficiency-safe ramps.
// Sequential: viridis (perceptually uniform, readable in all common CVD types
// and in greyscale). Diverging: PuOr (ColorBrewer, CVD-safe).
export const VIRIDIS = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];
export const PUOR = ["#542788", "#8073ac", "#b2abd2", "#d8daeb", "#f7f7f7", "#fee0b6", "#fdb863", "#e08214", "#b35806"];
export const ZERO_FILL = "#e9eeeb";
export const MISSING_FILL = "transparent";
/** Hatch for days outside the loaded period; >= 3:1 against ZERO_FILL and white. */
export const OUT_OF_PERIOD_HATCH = "#5f7069";

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
function interpolate(stops: string[], t: number) {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
}

/** Square-root scale (fire counts are heavily skewed); 0 gets its own neutral fill. */
export function sequential(max: number) {
  const m = Math.max(1, max);
  return (v: number | null | undefined) => (v == null ? MISSING_FILL : v <= 0 ? ZERO_FILL : interpolate(VIRIDIS, Math.sqrt(v / m)));
}
/** Legend ticks for the square-root scale. */
export const sequentialTicks = (max: number) => [0, 0.0625, 0.25, 0.5625, 1].map((f) => Math.round(f * Math.max(1, max)));

/** Diverging around 100 % of median on a log2 scale clipped to ×1/4 … ×4. */
export function diverging(pctOfMedian: number | null) {
  if (pctOfMedian == null || !Number.isFinite(pctOfMedian)) return MISSING_FILL;
  const t = (Math.max(-2, Math.min(2, Math.log2(Math.max(pctOfMedian, 1e-6) / 100))) + 2) / 4;
  return interpolate(PUOR, t); // below median = purple, above = orange
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(color: string) {
  const [r, g, b] = hex(color).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/**
 * Readable text (and marker) colour on a fill: black or white, whichever has
 * the higher contrast. This guarantees at least 4.58:1 on any opaque fill
 * (a dark green such as #132a24 can only guarantee about 3.9:1).
 */
export function textOn(fill: string) {
  if (!fill.startsWith("#")) return "#203c34";
  return contrast(fill, "#000000") >= contrast(fill, "#ffffff") ? "#000000" : "#ffffff";
}

export const fmt = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (m: string) => `${MONTH_ABBR[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

/** Linear viridis for shares in [0, 1] (sensor-disagreement map). */
export const shareColor = (v: number) => interpolate(VIRIDIS, Math.max(0, Math.min(1, v)));
