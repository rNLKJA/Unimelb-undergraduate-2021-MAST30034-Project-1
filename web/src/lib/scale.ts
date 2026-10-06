/** Colour classing for choropleths and heatmaps. */

export const SEQ_STEPS = 6;

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

/** Step of "nice" ticks (1, 2 or 5 times a power of ten) for about `count` intervals over [lo, hi]. */
export function niceStep(lo: number, hi: number, count = 5): number {
  const span = Math.abs(hi - lo) || Math.abs(hi) || 1;
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  return mult * pow;
}

/**
 * Round tick values covering [lo, hi]: the domain is widened outwards to whole
 * steps (like d3's `nice()`), so the first and last ticks are the axis ends.
 */
export function niceTicks(lo: number, hi: number, count = 5): { ticks: number[]; step: number } {
  const step = niceStep(lo, hi, count);
  const start = Math.floor(lo / step) * step;
  const stop = Math.ceil(hi / step) * step;
  const n = Math.round((stop - start) / step);
  // multiply instead of accumulate, and trim float noise (0.30000000000000004)
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((start + i * step).toPrecision(12)));
  return { ticks: ticks.length > 1 ? ticks : [start, start + step], step };
}

/** Decimal places needed to print ticks of this step without noise. */
export function stepDecimals(step: number): number {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}
