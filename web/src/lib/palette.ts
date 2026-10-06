/** Concrete colours for canvas/WebGL consumers (MapLibre, SVG fills) that cannot read CSS variables. */

export type ThemeName = "light" | "dark";

/** Sequential ramp (same values as --seq-0..5 in globals.css). */
export const SEQ_HEX: Record<ThemeName, string[]> = {
  light: ["#f3ead2", "#f6d77a", "#f2b72c", "#dd8a14", "#ae5a12", "#6e3410"],
  dark: ["#2a2a2c", "#4d4128", "#87661d", "#c39114", "#f2b72c", "#ffe17a"],
};

export const NODATA_HEX: Record<ThemeName, string> = { light: "#e3dccb", dark: "#26272b" };
export const INK_HEX: Record<ThemeName, string> = { light: "#1d1d21", dark: "#efe9dc" };
export const PAPER_HEX: Record<ThemeName, string> = { light: "#f4efe3", dark: "#16171b" };
export const TAXI_HEX = "#f7b928";

/** Colour of a ramp class (0..5), or the no-data colour for -1. */
export function seqColor(theme: ThemeName, rampIdx: number): string {
  return rampIdx < 0 ? NODATA_HEX[theme] : SEQ_HEX[theme][Math.min(rampIdx, SEQ_HEX[theme].length - 1)];
}
