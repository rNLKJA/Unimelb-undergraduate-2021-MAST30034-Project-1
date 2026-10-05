/** Great-circle distance in miles between two [lon, lat] points (haversine). */
export function haversineMiles(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 3958.7613; // mean Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A gentle arc between two points for subway-style route lines: a quadratic
 * Bezier bowed `bend` x the chord length to the left, sampled at `steps` points.
 */
export function arc(
  a: readonly [number, number],
  b: readonly [number, number],
  bend = 0.12,
  steps = 24,
): [number, number][] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return out;
}

/** New York City extent used to frame maps ([west, south], [east, north]). */
export const NYC_BOUNDS: [[number, number], [number, number]] = [
  [-74.26, 40.49],
  [-73.69, 40.92],
];
