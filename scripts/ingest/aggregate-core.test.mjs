import { test } from "node:test";
import assert from "node:assert/strict";
import { latLngToCell, cellToParent } from "h3-js";
import { PLATFORM_BIT, platformOf, CellDayAccumulator, unionCount, maskMatches } from "./aggregate-core.mjs";

const row = (o) => ({ latitude: "34.0", longitude: "-118.0", acq_date: "2024-08-01", acq_time: "2030", satellite: "N", instrument: "VIIRS", daynight: "D", frp: "5", ...o });

test("platform bits are distinct powers of two", () => {
  const bits = Object.values(PLATFORM_BIT);
  assert.equal(new Set(bits).size, 5);
  assert.ok(bits.every((b) => (b & (b - 1)) === 0));
});

test("platformOf maps FIRMS satellite codes for archive and NRT", () => {
  assert.equal(platformOf("Terra"), "Terra");
  assert.equal(platformOf("T"), "Terra");
  assert.equal(platformOf("Aqua"), "Aqua");
  assert.equal(platformOf("N"), "S-NPP");
  assert.equal(platformOf("N20"), "NOAA-20");
  assert.equal(platformOf("N21"), "NOAA-21");
  assert.throws(() => platformOf("GOES"));
});

test("several detections by one platform in one ~1 km cell-day count as ONE fire-cell-day", () => {
  const acc = new CellDayAccumulator();
  acc.add(row({ latitude: "34.0000" }));
  acc.add(row({ latitude: "34.0002" })); // same res-8 cell (verified)
  acc.add(row({ latitude: "34.0001", acq_time: "0930", daynight: "N" }));
  const out = acc.coarse(5);
  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.det["S-NPP"], 3);
  assert.equal(unionCount(r.any, PLATFORM_BIT["S-NPP"]), 1);
  assert.equal(unionCount(r.day, PLATFORM_BIT["S-NPP"]), 1);
  assert.equal(unionCount(r.night, PLATFORM_BIT["S-NPP"]), 1);
});

test("any-sensor union counts a cell-day once even when MODIS and VIIRS both detect", () => {
  const acc = new CellDayAccumulator();
  acc.add(row({ satellite: "Aqua", instrument: "MODIS" }));
  acc.add(row({ satellite: "N" }));
  acc.add(row({ satellite: "N20" }));
  const [r] = acc.coarse(5);
  const ALL = 31;
  assert.equal(unionCount(r.any, ALL), 1, "union, not a sum");
  assert.equal(r.any[PLATFORM_BIT.Aqua | PLATFORM_BIT["S-NPP"] | PLATFORM_BIT["NOAA-20"]], 1);
  assert.equal(maskMatches(r.any, PLATFORM_BIT.Aqua, PLATFORM_BIT["S-NPP"]), 1, "both Aqua and S-NPP");
});

test("different days and different cells are separate fire-cell-days", () => {
  const acc = new CellDayAccumulator();
  acc.add(row({}));
  acc.add(row({ acq_date: "2024-08-02" }));
  acc.add(row({ longitude: "-117.99" })); // ~1 km east: different res-8 cell, same res-5 parent (verified)
  const c8a = latLngToCell(34.0, -118.0, 8), c8b = latLngToCell(34.0, -117.99, 8);
  assert.notEqual(c8a, c8b);
  assert.equal(cellToParent(c8a, 5), cellToParent(c8b, 5));
  const monthly = acc.coarse(5, "month");
  assert.equal(monthly.length, 1);
  assert.equal(unionCount(monthly[0].any, 31), 3);
  const daily = acc.coarse(5, "day");
  assert.equal(daily.length, 2);
});

test("static-source cells (gas flares, industry) are excluded from fire-cell-days but tallied", () => {
  const c8 = latLngToCell(34.0, -118.0, 8);
  const acc = new CellDayAccumulator({ staticCells: new Set([c8]) });
  acc.add(row({}));
  acc.add(row({ latitude: "35.0" }));
  const out = acc.coarse(5);
  assert.equal(out.reduce((s, r) => s + unionCount(r.any, 31), 0), 1);
  assert.equal(acc.excludedStatic, 1);
});

test("FRP sums per platform; missing FRP does not break totals", () => {
  const acc = new CellDayAccumulator();
  acc.add(row({ frp: "2.5" }));
  acc.add(row({ frp: "" }));
  const [r] = acc.coarse(5);
  assert.equal(r.frp["S-NPP"], 2.5);
  assert.equal(r.det["S-NPP"], 2);
});

test("rows outside an optional date window are rejected (no double counting at stitches)", () => {
  const acc = new CellDayAccumulator({ start: "2024-08-02", end: "2024-08-31" });
  acc.add(row({}));
  assert.equal(acc.coarse(5).length, 0);
  assert.equal(acc.outOfWindow, 1);
});

test("region clip drops detections outside the region and tallies them", () => {
  const inside = latLngToCell(34.0, -118.0, 8);
  const acc = new CellDayAccumulator({ inRegion: (cell8) => cell8 === inside });
  acc.add(row({}));
  acc.add(row({ latitude: "49.5", longitude: "-110.0" })); // southern Alberta, inside the CONUS box
  const out = acc.coarse(5);
  assert.equal(out.reduce((s, r) => s + unionCount(r.any, 31), 0), 1);
  assert.equal(acc.outsideRegion, 1);
  assert.equal(acc.accepted, 1);
});
