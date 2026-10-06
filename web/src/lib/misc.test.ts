import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";
import { formatMinutes, formatSigned } from "./format";
import { arc, haversineMiles } from "./geo";
import { siteUrl } from "./site";
import { zoneLabels } from "./zone-labels";

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

describe("siteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.org", VERCEL_URL: "x.vercel.app" }).href).toBe(
      "https://example.org/",
    );
  });

  it("uses the production domain on Vercel production builds", () => {
    const env = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "mast30034-nyc-taxi.vercel.app",
      VERCEL_URL: "mast30034-nyc-taxi-abc123.vercel.app",
    };
    expect(siteUrl(env).origin).toBe("https://mast30034-nyc-taxi.vercel.app");
  });

  it("uses the branch URL on preview builds", () => {
    const env = {
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "mast30034-nyc-taxi.vercel.app",
      VERCEL_BRANCH_URL: "mast30034-nyc-taxi-git-revive-web.vercel.app",
    };
    expect(siteUrl(env).origin).toBe("https://mast30034-nyc-taxi-git-revive-web.vercel.app");
  });

  it("falls back to localhost on the dev port", () => {
    expect(siteUrl({}).origin).toBe("http://localhost:3000");
    expect(siteUrl({ PORT: "3303" }).origin).toBe("http://localhost:3303");
  });
});

describe("zoneLabels", () => {
  it("adds the LocationID only to names that repeat", () => {
    const labels = zoneLabels([
      { id: 56, zone: "Corona", borough: "Queens" },
      { id: 57, zone: "Corona", borough: "Queens" },
      { id: 132, zone: "JFK Airport", borough: "Queens" },
    ]);
    expect([...labels.values()]).toEqual(["Corona (#56)", "Corona (#57)", "JFK Airport"]);
  });
});
