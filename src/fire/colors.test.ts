import { describe, expect, it } from "vitest";
import { contrast, diverging, OUT_OF_PERIOD_HATCH, sequential, textOn, ZERO_FILL } from "./colors";

const samples = (f: (t: number) => string) => Array.from({ length: 1001 }, (_, i) => f(i / 1000));

describe("colour contrast (WCAG)", () => {
  // Sequential fills over the full ramp (value = t² of max, because the scale is square-root).
  const viridis = samples((t) => sequential(1_000_000)(t * t * 1_000_000));
  // Diverging fills from 25 % to 400 % of median.
  const puor = samples((t) => diverging(100 * 2 ** (4 * t - 2)));

  it.each([["viridis", viridis], ["PuOr", puor]])("text on every %s fill is at least 4.5:1 (A11Y-2)", (_n, fills) => {
    const worst = Math.min(...fills.map((f) => contrast(f, textOn(f))));
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it("estimated/partial markers (drawn in textOn) reach 3:1 on every fill (A11Y-3)", () => {
    for (const f of [...viridis, ...puor, ZERO_FILL]) expect(contrast(f, textOn(f))).toBeGreaterThanOrEqual(3);
  });

  it("the out-of-period hatch differs from zero days and the page by at least 3:1 (A11Y-11)", () => {
    expect(contrast(OUT_OF_PERIOD_HATCH, ZERO_FILL)).toBeGreaterThanOrEqual(3);
    expect(contrast(OUT_OF_PERIOD_HATCH, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("contrast is symmetric and 21:1 for black on white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });
});
