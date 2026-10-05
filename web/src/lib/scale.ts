/** Colour classing for choropleths and heatmaps. */

export const SEQ_STEPS = 6;

/** CSS variable names of the sequential ramp (defined in globals.css for both themes). */
export const SEQ_VARS = Array.from({ length: SEQ_STEPS }, (_, i) => `--seq-${i}`);

/**
 * Quantile class breaks: `k - 1` thresholds splitting the positive values into
 * k roughly equal-count classes. Zeros/nulls are "no data" and not classed.
 */
export function quantileBreaks(values: readonly (number | null | undefined)[], k = SEQ_STEPS): number[] {
  const xs = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!xs.length) return [];
  const out: number[] = [];
  for (let i = 1; i < k; i++) {
    const pos = (xs.length - 1) * (i / k);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    out.push(xs[lo] + (xs[hi] - xs[lo]) * (pos - lo));
  }
  // collapse duplicates so classes stay strictly increasing
  return out.filter((v, i) => i === 0 || v > out[i - 1]);
}

/** Class index (0..breaks.length) of a value; -1 for no data. */
export function classify(v: number | null | undefined, breaks: readonly number[]): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return -1;
  let i = 0;
  while (i < breaks.length && v > breaks[i]) i++;
  return i;
}

/** Spread `classes` classes over the SEQ_STEPS ramp (so 3 classes use light, mid, dark). */
export function rampIndex(cls: number, classes: number): number {
  if (cls < 0) return -1;
  if (classes <= 1) return SEQ_STEPS - 1;
  return Math.round((cls / (classes - 1)) * (SEQ_STEPS - 1));
}

/** Linear interpolation of a value into [0, 1] between lo and hi (clamped). */
export function unit(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0.5;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}
