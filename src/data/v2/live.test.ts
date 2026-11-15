import { describe, it, expect } from "vitest";
import { stitchLive, hotspotsCsvUrl, type LiveDay } from "./live";

const day = (d: string, fineCellDays = 1): LiveDay => ({ day: d, total: [-1, 0, [], [], [], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], fineCellDays, detections: 0, sources: [], fetchedAt: 0, provisional: false });

describe("stitchLive", () => {
  it("never returns a day the static bundle already covers, and keeps one row per day", () => {
    const out = stitchLive("2026-11-14", [day("2026-11-16"), day("2026-11-13"), day("2026-11-14"), day("2026-11-15", 1), day("2026-11-15", 9)]);
    expect(out.map((d) => [d.day, d.fineCellDays])).toEqual([["2026-11-15", 9], ["2026-11-16", 1]]);
  });
});

describe("hotspotsCsvUrl", () => {
  it("builds the export URL and returns null without a backend", () => {
    expect(hotspotsCsvUrl({ bbox: [-120, 30, -110.123456, 40], start: "2026-11-01", end: "2026-11-03", sensors: ["viirs"] }, "https://x.convex.site/")).toBe(
      "https://x.convex.site/hotspots.csv?bbox=-120.0000%2C30.0000%2C-110.1235%2C40.0000&start=2026-11-01&end=2026-11-03&sensors=viirs",
    );
    expect(hotspotsCsvUrl({ bbox: [0, 0, 1, 1], start: "2026-11-01", end: "2026-11-01" }, null)).toBeNull();
  });
});
