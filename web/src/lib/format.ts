const int = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 1 });

export function formatInt(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "–" : int.format(n);
}

export function formatCompact(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "–" : compact.format(n);
}

export function formatFixed(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const s = n.toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  // a small negative number that rounds to zero is zero, not "-0.000"
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** "12.4 min" */
export function formatMinutes(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || Number.isNaN(n) ? "–" : `${formatFixed(n, digits)} min`;
}

/** "+1.2" / "−0.4" with a real minus sign */
export function formatSigned(n: number, digits = 1): string {
  const s = Math.abs(n).toLocaleString("en-AU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (Number(s) === 0) return s;
  return n > 0 ? `+${s}` : `−${s}`;
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || Number.isNaN(n) ? "–" : `${formatFixed(n * 100, digits)}%`;
}

/** "9.47 (9.18 to 9.73)": an estimate with its interval, en-AU number formatting. */
export function formatInterval(
  ci: { estimate: number; lower: number; upper: number },
  digits = 2,
  unit = "",
): string {
  const f = (v: number) => `${formatFixed(v, digits)}${unit}`;
  return `${f(ci.estimate)} (${f(ci.lower)} to ${f(ci.upper)})`;
}

/** Signed percentage, "+4.5%" / "−0.6%" with a real minus sign. */
export function formatSignedPct(n: number, digits = 1): string {
  return `${formatSigned(n * 100, digits)}%`;
}

/** "+4.5% (+2.0% to +7.1%)" */
export function formatPctInterval(
  ci: { estimate: number; lower: number; upper: number },
  digits = 1,
): string {
  return `${formatSignedPct(ci.estimate, digits)} (${formatSignedPct(ci.lower, digits)} to ${formatSignedPct(ci.upper, digits)})`;
}

/** p-values: "< 0.001" below a thousandth, otherwise three decimals. */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return "–";
  return p < 0.001 ? "< 0.001" : formatFixed(p, 3);
}

/** Axis ticks in percent: whole numbers where exact, one decimal otherwise (so 2.5% never shows as 3%). */
export function formatPctTick(v: number): string {
  const pct = Math.round(v * 1000) / 10;
  return `${formatFixed(pct, Number.isInteger(pct) ? 0 : 1)}%`;
}
