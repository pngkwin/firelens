import { describe, it, expect } from "vitest";
import { aoiPolys, circlePolygon, decodeAoi, encodeAoi, inPolys, makeAoiTest, polysAreaKm2, polysBbox, type Aoi, type Polys } from "./aoi";

describe("AOI geometry", () => {
  it("tests points with holes using the even-odd rule", () => {
    const polys: Polys = [[
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ]];
    expect(inPolys(1, 1, polys)).toBe(true);
    expect(inPolys(5, 5, polys)).toBe(false);
    expect(inPolys(11, 5, polys)).toBe(false);
  });

  it("builds geodesic circles of the requested radius", () => {
    const ring = circlePolygon([-120, 37], 100);
    const [w, s, e, n] = polysBbox([[ring]]);
    expect((n - s) * 111.2).toBeCloseTo(200, -1); // ~200 km tall
    expect((e - w) * 111.2 * Math.cos((37 * Math.PI) / 180)).toBeCloseTo(200, -1);
    expect(polysAreaKm2([[ring]])).toBeGreaterThan(Math.PI * 100 * 100 * 0.98);
    expect(polysAreaKm2([[ring]])).toBeLessThan(Math.PI * 100 * 100 * 1.02);
  });

  it("resolves every AOI kind to polygons, and the whole region to null", () => {
    expect(aoiPolys({ kind: "region" })).toBeNull();
    expect(aoiPolys({ kind: "bbox", bbox: [-1, -1, 1, 1] })).toEqual([[[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]]);
    const ring = aoiPolys({ kind: "polygon", ring: [[0, 0], [1, 0], [0, 1]] })![0][0];
    expect(ring.at(-1)).toEqual([0, 0]);
    expect(aoiPolys({ kind: "preset", id: "us-06" }, (id) => (id === "us-06" ? [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] : null))).toHaveLength(1);
    const test = makeAoiTest(aoiPolys({ kind: "circle", center: [10, 10], radiusKm: 50 }));
    expect(test(10, 10)).toBe(true);
    expect(test(11, 10)).toBe(false);
    expect(makeAoiTest(null)(0, 0)).toBe(true);
  });
});

describe("AOI URL encoding", () => {
  const cases: Aoi[] = [
    { kind: "region" },
    { kind: "preset", id: "us-06" },
    { kind: "bbox", bbox: [-124.5, 32.5, -114.1, 42] },
    { kind: "circle", center: [-119.5, 37.25], radiusKm: 75 },
    { kind: "polygon", ring: [[-120, 35], [-118, 35], [-119, 37.5]] },
  ];
  it.each(cases)("round-trips $kind", (aoi) => {
    expect(decodeAoi(encodeAoi(aoi))).toEqual({ ok: true, aoi });
  });
  it.each([
    ["bbox:1,2,3", /west,south,east,north/],
    ["bbox:5,0,1,1", /west < east/],
    ["circle:0,95,10", /longitude and latitude/],
    ["circle:0,0,0", /Radius/],
    ["poly:0,0;1,1", /three/],
    ["preset:../x", /preset/],
    ["triangle:1", /Unrecognized/],
  ])("rejects %s", (s, msg) => {
    const r = decodeAoi(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});
