/** RFC 4180 CSV: quote fields containing a comma, quote, CR or LF; double embedded quotes. */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.map(csvField).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvField(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}
