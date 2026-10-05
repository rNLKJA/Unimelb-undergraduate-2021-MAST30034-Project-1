import { ImageResponse } from "next/og";
import hero from "@/lib/data/hero-map.json";
import { INK_HEX, PAPER_HEX, TAXI_HEX, seqColor } from "@/lib/palette";
import { classify, quantileBreaks, rampIndex } from "@/lib/scale";
import { SITE } from "@/lib/site";

export const alt = `${SITE.title}: 2019 NYC yellow-taxi pickups by taxi zone`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The landing-page choropleth as an SVG data URI (light theme colours). */
function mapDataUri(): string {
  const breaks = quantileBreaks(hero.zones.map((z) => z.trips));
  const classes = breaks.length + 1;
  const paths = hero.zones
    .map((z) => {
      const fill = seqColor("light", rampIndex(classify(z.trips, breaks), classes));
      return `<path d="${z.d}" fill="${fill}"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${hero.width} ${hero.height}"><g stroke="${PAPER_HEX.light}" stroke-width="0.8" stroke-linejoin="round">${paths}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export default function OpengraphImage() {
  const ink = INK_HEX.light;
  const mapHeight = 500;
  const mapWidth = Math.round((hero.width / hero.height) * mapHeight);
  // The bundled OG font has a single (regular) weight; a text stroke gives the headline its heft.
  const heavy = { WebkitTextStroke: `2.5px ${ink}` };
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: PAPER_HEX.light,
        color: ink,
      }}
    >
      <div style={{ display: "flex", height: 8, background: TAXI_HEX }} />
      <div style={{ display: "flex", flex: 1, alignItems: "center", padding: "0 48px 0 64px" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 620 }}>
          <div
            style={{ display: "flex", fontSize: 21, letterSpacing: 5, opacity: 0.65, whiteSpace: "nowrap" }}
          >
            MAST30034 · UNIMELB · 2021 → 2026
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 22,
              fontSize: 70,
              lineHeight: 1.02,
              letterSpacing: -1,
              ...heavy,
            }}
          >
            <span>WHERE, WHEN</span>
            <span style={{ display: "flex" }}>
              AND HOW LONG<span style={{ color: TAXI_HEX, WebkitTextStroke: `2.5px ${TAXI_HEX}` }}>.</span>
            </span>
          </div>
          <div style={{ display: "flex", marginTop: 26, fontSize: 29, lineHeight: 1.35, opacity: 0.85 }}>
            84.6 million New York yellow-cab rides of 2019, cleaned, mapped and modelled.
          </div>
          <div style={{ display: "flex", marginTop: 30 }}>
            <div
              style={{
                display: "flex",
                background: TAXI_HEX,
                color: ink,
                padding: "10px 18px",
                borderRadius: 8,
                fontSize: 25,
                WebkitTextStroke: `0.8px ${ink}`,
              }}
            >
              NYC TAXI 2019
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, justifyContent: "flex-end" }}>
          <img src={mapDataUri()} width={mapWidth} height={mapHeight} alt="" />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          height: 20,
          backgroundImage: `linear-gradient(90deg, ${ink} 50%, transparent 50%)`,
          backgroundSize: "20px 20px",
        }}
      />
    </div>,
    size,
  );
}
