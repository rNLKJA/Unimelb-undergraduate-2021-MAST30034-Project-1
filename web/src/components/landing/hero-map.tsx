import hero from "@/lib/data/hero-map.json";
import { classify, quantileBreaks, rampIndex } from "@/lib/scale";

/**
 * Static SVG of the 2019 pickups by taxi zone (pre-projected by
 * scripts/build_analytics.py), coloured with the theme's sequential ramp.
 */
export function HeroMap({ className }: { className?: string }) {
  const breaks = quantileBreaks(hero.zones.map((z) => z.trips));
  const classes = breaks.length + 1;
  return (
    <svg
      viewBox={`0 0 ${hero.width} ${hero.height}`}
      className={className}
      role="img"
      aria-labelledby="hero-map-title"
    >
      <title id="hero-map-title">
        Map of New York City&apos;s taxi zones shaded by 2019 yellow-taxi pickups: busiest in Manhattan below
        Central Park and at the two airports.
      </title>
      <g strokeWidth={0.6} strokeLinejoin="round" className="stroke-background">
        {hero.zones.map((z) => {
          const r = rampIndex(classify(z.trips, breaks), classes);
          return (
            <path key={z.id} d={z.d} style={{ fill: r < 0 ? "var(--map-nodata)" : `var(--seq-${r})` }} />
          );
        })}
      </g>
    </svg>
  );
}
