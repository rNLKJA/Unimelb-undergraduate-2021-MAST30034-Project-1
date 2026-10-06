"use client";

import dynamic from "next/dynamic";
import type { ZoneMapProps } from "./zone-map";
import { cn } from "@/lib/utils";

/** MapLibre needs WebGL and `window`: load it only in the browser. */
const ZoneMap = dynamic(() => import("./zone-map").then((m) => m.ZoneMap), {
  ssr: false,
  loading: () => (
    <div className="bg-muted text-muted-foreground grid h-full place-items-center text-sm">
      <span className="animate-pulse">Loading map…</span>
    </div>
  ),
});

/** Sized wrapper: `className` sets the box (identical while loading) and the map fills it. */
export function LazyZoneMap({ className, ...props }: ZoneMapProps) {
  return (
    <div className={cn("relative", className)}>
      <ZoneMap {...props} className="absolute inset-0" />
    </div>
  );
}
