// Unit tests for review findings fixed in the Fire calendar UI helpers.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportBoxes, polysBbox, decodeAoi, type Polys } from "../data/v2/aoi";
import { SCALES, type Scale } from "../data/v2/analysis";
import { ord } from "./EventsPanel";
import { pngSubtitle } from "./png";
import { verticesToParam } from "./AoiPanel";
import { shortValue } from "./MonthHeatmap";

const presets = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../public/data/presets/us.json"), "utf8")) as { items: Array<{ id: string; name: string; polys: Polys }> };

describe("BUG-1: export boxes across the antimeridian", () => {
  it("splits Alaska (us-02) into two boxes, each narrower than 180°", () => {
    const alaska = presets.items.find((p) => p.id === "us-02")!.polys;
    expect(polysBbox(alaska)[2] - polysBbox(alaska)[0]).toBeGreaterThan(300); // the old world-wide box
    const boxes = exportBoxes(alaska);
    expect(boxes).toHaveLength(2);
    for (const [w, s, e, n] of boxes) { expect(e - w).toBeLessThan(180); expect(w).toBeLessThan(e); expect(s).toBeLessThan(n); }
    expect(boxes.some((b) => b[2] === 180)).toBe(true);
    expect(boxes.some((b) => b[0] === -180)).toBe(true);
  });
  it("keeps one box for ordinary areas", () => {
    const ca = presets.items.find((p) => p.name === "California")!.polys;
    expect(exportBoxes(ca)).toEqual([polysBbox(ca)]);
  });
});

describe("BUG-3: PNG subtitle follows the scale's unit", () => {
  it.each(Object.keys(SCALES) as Scale[])("%s", (scale) => {
    expect(pngSubtitle(scale)).toContain(`${SCALES[scale].unit} per month`);
  });
  it("says hotspots, not fire-cell-days, for hotspot scales", () => {
    expect(pngSubtitle("hotspots-viirs")).not.toContain("fire-cell-days per month");
  });
});

describe("BUG-5: ordinal percentiles", () => {
  it.each([[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [23, "23rd"], [100, "100th"], [21.6, "22nd"]])("%d -> %s", (n, s) => {
    expect(ord(n)).toBe(`${s} percentile`);
  });
  it("shows a dash for missing values", () => expect(ord(NaN)).toBe("–"));
});

describe("A11Y-4: polygon vertices form", () => {
  it("accepts one pair per line, with commas or spaces, and decodes to a polygon", () => {
    const param = verticesToParam(" -122.5, 38.5\n-121.0 38.5\n\n-121.0,39.5\r\n-122.5, 39.5 ");
    expect(param).toBe("-122.5,38.5;-121.0,38.5;-121.0,39.5;-122.5,39.5");
    const r = decodeAoi(`poly:${param}`);
    expect(r.ok && r.aoi.kind === "polygon" && r.aoi.ring.length).toBe(4);
  });
  it("rejects fewer than three vertices", () => {
    expect(decodeAoi(`poly:${verticesToParam("1,2\n3,4")}`).ok).toBe(false);
  });
});

describe("A11Y-7: visible cell text", () => {
  it.each([[null, ""], [0, "0"], [999, "999"], [1234, "1.2k"], [12345, "12k"]])("%s -> %j", (v, s) => expect(shortValue(v as number | null)).toBe(s));
});
