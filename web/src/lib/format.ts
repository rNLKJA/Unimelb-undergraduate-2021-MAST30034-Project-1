const int = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-AU", { notation: "compact", maximumFractionDigits: 1 });

export function formatInt(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "–" : int.format(n);
}

export function formatCompact(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "–" : compact.format(n);
}

export function formatFixed(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || Number.isNaN(n)
    ? "–"
    : n.toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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
