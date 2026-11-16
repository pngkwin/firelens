import { describe, expect, it } from "vitest";
import { filterPointsCsv, guardFormula } from "./exportsV2";

describe("formula guard (SEC-5)", () => {
  it.each([
    ["=cmd", "'=cmd"], ["+SUM(1)", "'+SUM(1)"], ["@x", "'@x"], ["-x", "'-x"], ["\tx", "'\tx"],
    ["-120.5", "-120.5"], ["+3", "+3"], ["0", "0"], ["MODIS", "MODIS"], ["", ""],
  ])("%j -> %j", (input, out) => expect(guardFormula(input)).toBe(out));

  it("filterPointsCsv re-emits guarded fields and keeps coordinates", () => {
    const csv = "source,latitude,longitude,version\nX,38,-120.5,=evil()\nX,10,10,ok\n";
    const r = filterPointsCsv(csv, (lon) => lon < 0);
    expect(r.kept).toBe(1);
    expect(r.csv).toBe("source,latitude,longitude,version\nX,38,-120.5,'=evil()\n");
  });
});
