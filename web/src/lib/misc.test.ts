import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { formatMinutes, formatSigned } from "./format";
import { arc, haversineMiles } from "./geo";

describe("csv", () => {
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    const out = toCsv(
      ["a", "b"],
      [
        { a: 'say "hi"', b: "x,y" },
        { a: null, b: "line\nbreak" },
      ],
    );
    expect(out).toBe('a,b\r\n"say ""hi""","x,y"\r\n,"line\nbreak"\r\n');
  });
});

describe("geo", () => {
  it("measures JFK to LaGuardia as about 10.7 miles", () => {
    expect(haversineMiles([-73.7781, 40.6413], [-73.874, 40.7769])).toBeCloseTo(10.65, 0);
  });

  it("arcs start and end on the endpoints", () => {
    const pts = arc([0, 0], [1, 1], 0.2, 10);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)![0]).toBeCloseTo(1, 12);
    expect(pts).toHaveLength(11);
  });
});

describe("format", () => {
  it("uses a real minus sign and keeps zero unsigned", () => {
    expect(formatSigned(-1.25)).toBe("−1.3");
    expect(formatSigned(2)).toBe("+2.0");
    expect(formatSigned(0)).toBe("0.0");
    expect(formatMinutes(12.345)).toBe("12.3 min");
  });
});
