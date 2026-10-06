/**
 * Weekday conventions. Three are in play and mixing them up shifts every chart:
 *  - ISO (analytics.db, DuckDB isodow): 1 = Monday ... 7 = Sunday
 *  - Spark dayofweek (the 2021 model, cell 259): 1 = Sunday ... 7 = Saturday
 *  - pandas weekday() + 1 (the 2021 vendor charts, cell 227): 1 = Monday ... 7 = Sunday (same as ISO)
 */

export const ISO_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export const ISO_WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** ISO weekday (1 = Monday) to Spark dayofweek (1 = Sunday). */
export function isoToSparkWeekday(iso: number): number {
  return (iso % 7) + 1;
}

/** Spark dayofweek (1 = Sunday) to ISO weekday (1 = Monday). */
export function sparkToIsoWeekday(spark: number): number {
  return spark === 1 ? 7 : spark - 1;
}

/** ISO weekday of a "YYYY-MM-DD" calendar date. */
export function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

export function isoWeekdayName(iso: number, short = false): string {
  return (short ? ISO_WEEKDAYS_SHORT : ISO_WEEKDAYS)[iso - 1] ?? "";
}

/** "7 am", "12 pm", "11 pm" */
export function hourLabel(h: number): string {
  if (h === 0) return "12 am";
  if (h === 12) return "12 pm";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

/** All dates of 2019 as "YYYY-MM-DD". */
export function datesOf2019(): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(2019, 0, 1); t < Date.UTC(2020, 0, 1); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function formatDate(
  date: string,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { ...opts, timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
