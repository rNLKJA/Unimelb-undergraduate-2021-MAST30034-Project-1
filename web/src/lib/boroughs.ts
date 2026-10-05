/** Borough colours borrow MTA subway line colours (CSS variables in globals.css). */
export const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "EWR"] as const;
export type Borough = (typeof BOROUGHS)[number];

export const BOROUGH_VAR: Record<string, string> = {
  Manhattan: "var(--line-red)",
  Brooklyn: "var(--line-blue)",
  Queens: "var(--line-purple)",
  Bronx: "var(--line-green)",
  "Staten Island": "var(--line-orange)",
  EWR: "var(--line-grey)",
  Unknown: "var(--line-grey)",
};

/** Same colours as hex, for MapLibre paint properties (light, dark). */
export const BOROUGH_HEX: Record<string, [string, string]> = {
  Manhattan: ["#d6302a", "#ff5a50"],
  Brooklyn: ["#0039a6", "#5b8cff"],
  Queens: ["#a52f9c", "#e06bd5"],
  Bronx: ["#00843a", "#2fbf62"],
  "Staten Island": ["#e8590f", "#ff8a3d"],
  EWR: ["#7c7f85", "#b6b9be"],
};

/** Subway palette cycled for route lines. */
export const LINE_HEX: [string, string][] = [
  ["#d6302a", "#ff5a50"],
  ["#0039a6", "#5b8cff"],
  ["#00843a", "#2fbf62"],
  ["#a52f9c", "#e06bd5"],
  ["#e8590f", "#ff8a3d"],
  ["#4f9a2f", "#9be06c"],
  ["#8a5a2b", "#c99258"],
  ["#7c7f85", "#b6b9be"],
];

export function boroughShort(b: string): string {
  return b === "Staten Island" ? "Staten Is." : b;
}
