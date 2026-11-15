import { describe, expect, it } from "vitest";
import {
  ALL,
  BIT,
  MODIS,
  VIIRS,
  addHist,
  both,
  decodeHist,
  encodeHist,
  union,
} from "./codec";

describe("fire-cell-day histogram codec", () => {
  it("round-trips a sparse {mask: count} histogram as a sorted flat array", () => {
    const flat = encodeHist({ 4: 3, 1: 2, 6: 1 });
    expect(flat).toEqual([1, 2, 4, 3, 6, 1]);
    expect(decodeHist(flat)).toEqual({ 1: 2, 4: 3, 6: 1 });
  });

  it("drops zero counts and rejects malformed input", () => {
    expect(encodeHist({ 2: 0, 8: 5 })).toEqual([8, 5]);
    expect(() => decodeHist([1, 2, 3])).toThrow();
    expect(() => encodeHist({ 40: 1 })).toThrow(); // mask outside 5 platforms
  });

  it("union counts each cell-day once across platforms (any-sensor rule)", () => {
    // 2 cell-days Terra only, 3 S-NPP only, 1 seen by both Aqua and S-NPP
    const h = encodeHist({ [BIT.Terra]: 2, [BIT["S-NPP"]]: 3, [BIT.Aqua | BIT["S-NPP"]]: 1 });
    expect(union(h, ALL)).toBe(6);
    expect(union(h, MODIS)).toBe(3);
    expect(union(h, VIIRS)).toBe(4);
    expect(union(h, BIT["S-NPP"])).toBe(4);
    expect(both(h, MODIS, VIIRS)).toBe(1);
  });

  it("adds histograms exactly (additive across cells and periods)", () => {
    const a = encodeHist({ 1: 1, 4: 2 });
    const b = encodeHist({ 4: 3, 5: 1 });
    expect(addHist(a, b)).toEqual([1, 1, 4, 5, 5, 1]);
    expect(union(addHist(a, b), ALL)).toBe(union(a, ALL) + union(b, ALL));
  });
});
