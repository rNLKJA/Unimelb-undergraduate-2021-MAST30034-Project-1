"use client";

import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useThemeName } from "@/hooks/use-theme-name";
import { NYC_BOUNDS } from "@/lib/geo";
import { INK_HEX, NODATA_HEX, PAPER_HEX, type ThemeName } from "@/lib/palette";
import { cn } from "@/lib/utils";

// The worker is copied to public/ by tools/copy-maplibre-worker.mjs (pre-dev/pre-build).
maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");

/** OpenFreeMap vector styles: free, no key, no account. */
const BASEMAP: Record<ThemeName, string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const MAX_BOUNDS: LngLatBoundsLike = [
  [-74.9, 40.25],
  [-73.2, 41.15],
];

type ZoneProps = { id: number; zone: string; borough: string };
type Zones = FeatureCollection<Polygon | MultiPolygon, ZoneProps>;

let zonesPromise: Promise<Zones> | null = null;
let boroughsPromise: Promise<FeatureCollection> | null = null;

function loadZones(): Promise<Zones> {
  zonesPromise ??= fetch("/data/zones.geojson").then((r) => {
    if (!r.ok) throw new Error("zones.geojson failed to load");
    return r.json() as Promise<Zones>;
  });
  zonesPromise.catch(() => (zonesPromise = null));
  return zonesPromise;
}

function loadBoroughs(): Promise<FeatureCollection> {
  boroughsPromise ??= fetch("/data/boroughs.geojson").then((r) => r.json() as Promise<FeatureCollection>);
  boroughsPromise.catch(() => (boroughsPromise = null));
  return boroughsPromise;
}

/** Local fallback basemap: paper/asphalt background; borough land is added as an overlay. */
function fallbackStyle(theme: ThemeName): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": theme === "dark" ? "#0f1013" : "#dfe6ea" },
      },
    ],
  };
}

export interface RouteLine {
  id: string;
  coords: [number, number][];
  color: string;
  width: number;
}

export interface Station {
  id: number;
  coord: [number, number];
  kind: "origin" | "stop";
}

export interface ZoneMapProps {
  /** zone id -> fill colour (zones without an entry get the no-data colour) */
  fills: Record<number, string>;
  fillOpacity?: number;
  selected?: number | null;
  secondary?: number | null;
  lines?: RouteLine[];
  stations?: Station[];
  onSelect?: (id: number | null) => void;
  describe?: (id: number, zone: string, borough: string) => { title: string; lines: string[] } | null;
  ariaLabel: string;
  className?: string;
  /** zoom to the selected zone when it changes */
  flyToSelected?: boolean;
  /** fit the view to these [lon, lat] points whenever they change */
  focus?: [number, number][];
}

export function ZoneMap({
  fills,
  fillOpacity = 0.84,
  selected = null,
  secondary = null,
  lines = [],
  stations = [],
  onSelect,
  describe,
  ariaLabel,
  className,
  flyToSelected = false,
  focus,
}: ZoneMapProps) {
  const theme = useThemeName();
  const reducedMotion = usePrefersReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const zonesRef = useRef<Zones | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback" | "error">("loading");
  const [tip, setTip] = useState<{ x: number; y: number; w: number; title: string; lines: string[] } | null>(
    null,
  );

  const latest = useRef({
    fills,
    fillOpacity,
    selected,
    secondary,
    lines,
    stations,
    onSelect,
    describe,
    theme,
  });
  useEffect(() => {
    latest.current = { fills, fillOpacity, selected, secondary, lines, stations, onSelect, describe, theme };
  });
  const ctl = useRef<{ setTheme: (t: ThemeName) => void } | null>(null);
  const applied = useRef<Set<number>>(new Set());

  // ---- create the map once --------------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let usedFallback = false;
    let styleReady = false;
    let styleGen = 0;
    let hovered: number | null = null;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    const map = new maplibregl.Map({
      container: container.current,
      style: BASEMAP[latest.current.theme],
      bounds: NYC_BOUNDS,
      fitBoundsOptions: { padding: 12 },
      maxBounds: MAX_BOUNDS,
      attributionControl: { compact: true },
      cooperativeGestures: coarse,
      dragRotate: false,
      pitchWithRotate: false,
      minZoom: 8.5,
      maxZoom: 15,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    const setStyle = (style: string | StyleSpecification) => {
      styleReady = false;
      styleGen++;
      applied.current = new Set();
      setReady(false);
      map.setStyle(style, { diff: false });
    };

    /** Insert overlays above every basemap fill/line layer (roads too) but below the trailing labels. */
    const firstSymbol = () => {
      const layers = map.getStyle().layers ?? [];
      let last = -1;
      layers.forEach((l, i) => {
        if (l.type !== "symbol") last = i;
      });
      return layers[last + 1]?.id;
    };

    const addOverlay = async () => {
      if (cancelled || !styleReady || map.getSource("zones")) return;
      const gen = styleGen;
      let zones: Zones;
      let boroughs: FeatureCollection | null = null;
      try {
        [zones, boroughs] = await Promise.all([
          loadZones(),
          usedFallback ? loadBoroughs().catch(() => null) : null,
        ]);
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (cancelled || gen !== styleGen || !styleReady || map.getSource("zones")) return;
      zonesRef.current = zones;
      const t = latest.current.theme;
      const ink = INK_HEX[t];
      const before = firstSymbol();
      if (boroughs && !map.getSource("boroughs")) {
        map.addSource("boroughs", { type: "geojson", data: boroughs });
        map.addLayer({
          id: "boroughs-land",
          type: "fill",
          source: "boroughs",
          paint: { "fill-color": PAPER_HEX[t] },
        });
      }
      map.addSource("zones", { type: "geojson", data: zones, promoteId: "id" });
      map.addLayer(
        {
          id: "zones-fill",
          type: "fill",
          source: "zones",
          paint: {
            "fill-color": ["coalesce", ["feature-state", "fill"], NODATA_HEX[t]],
            "fill-opacity": latest.current.fillOpacity,
          },
        },
        before,
      );
      map.addLayer(
        {
          id: "zones-line",
          type: "line",
          source: "zones",
          paint: {
            "line-color": t === "dark" ? "#0d0e10" : "#fffaf0",
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.4, 0.5],
            "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.8],
          },
        },
        before,
      );
      map.addLayer({
        id: "zones-secondary",
        type: "line",
        source: "zones",
        filter: ["==", ["get", "id"], latest.current.secondary ?? -1],
        paint: { "line-color": ink, "line-width": 2, "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: "zones-selected",
        type: "line",
        source: "zones",
        filter: ["==", ["get", "id"], latest.current.selected ?? -1],
        paint: { "line-color": ink, "line-width": 2.6 },
      });
      // subway-style route lines: casing + coloured core + station dots
      map.addSource("routes", { type: "geojson", data: routesGeoJson(latest.current.lines) });
      map.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": PAPER_HEX[t], "line-width": ["+", ["get", "width"], 3] },
      });
      map.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"] },
      });
      map.addSource("stations", { type: "geojson", data: stationsGeoJson(latest.current.stations) });
      map.addLayer({
        id: "stations",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "origin"], 7, 4.5],
          "circle-color": ["case", ["==", ["get", "kind"], "origin"], ink, PAPER_HEX[t]],
          "circle-stroke-color": ["case", ["==", ["get", "kind"], "origin"], PAPER_HEX[t], ink],
          "circle-stroke-width": 2,
        },
      });
      applyFills(map, latest.current.fills, applied.current);
      setReady(true);
      setStatus(usedFallback ? "fallback" : "ready");
    };

    const switchToFallback = () => {
      if (usedFallback || cancelled) return;
      usedFallback = true;
      setStyle(fallbackStyle(latest.current.theme));
    };
    const timeout = window.setTimeout(() => {
      if (!styleReady) switchToFallback();
    }, 9000);

    ctl.current = { setTheme: (t) => setStyle(usedFallback ? fallbackStyle(t) : BASEMAP[t]) };

    map.on("style.load", () => {
      styleReady = true;
      void addOverlay();
    });
    map.on("error", (e) => {
      if (
        !styleReady &&
        /style|Failed to fetch|NetworkError|AJAXError/i.test(String(e.error?.message ?? ""))
      ) {
        switchToFallback();
      }
    });
    map.on("idle", () => {
      if (styleReady && !map.getSource("zones")) void addOverlay();
    });
    map.setMissingStyleImageResolver((id) => {
      if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    map.on("mousemove", "zones-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = Number(f.properties?.id);
      if (hovered !== id) {
        if (hovered !== null) map.setFeatureState({ source: "zones", id: hovered }, { hover: false });
        hovered = id;
        map.setFeatureState({ source: "zones", id }, { hover: true });
      }
      map.getCanvas().style.cursor = latest.current.onSelect ? "pointer" : "";
      const zone = String(f.properties?.zone ?? id);
      const borough = String(f.properties?.borough ?? "");
      const d = latest.current.describe?.(id, zone, borough) ?? { title: zone, lines: [borough] };
      setTip({ x: e.point.x, y: e.point.y, w: map.getContainer().clientWidth, ...d });
    });
    map.on("mouseleave", "zones-fill", () => {
      if (hovered !== null) map.setFeatureState({ source: "zones", id: hovered }, { hover: false });
      hovered = null;
      map.getCanvas().style.cursor = "";
      setTip(null);
    });
    map.on("click", (e) => {
      if (!latest.current.onSelect) return;
      const f = map.getLayer("zones-fill")
        ? map.queryRenderedFeatures(e.point, { layers: ["zones-fill"] })[0]
        : undefined;
      latest.current.onSelect(f ? Number(f.properties?.id) : null);
    });

    // On narrow maps the expanded attribution covers the bottom edge. MapLibre folds it
    // away on the first drag; also fold it after a few seconds, once it has been seen
    // (the OSMF attribution guidelines allow collapsing it on small maps after display).
    const foldAttribution = window.setTimeout(() => {
      if (map.getCanvasContainer().offsetWidth > 640) return;
      map
        .getContainer()
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
    }, 6000);

    return () => {
      cancelled = true;
      ctl.current = null;
      window.clearTimeout(timeout);
      window.clearTimeout(foldAttribution);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- theme switch: swap basemap; the overlay is re-added on style.load ----------
  const firstTheme = useRef(theme);
  useEffect(() => {
    if (theme === firstTheme.current) return;
    firstTheme.current = theme;
    ctl.current?.setTheme(theme);
  }, [theme]);

  // ---- fills ----------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("zones")) return;
    applyFills(map, fills, applied.current);
  }, [fills, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("zones-fill")) return;
    map.setPaintProperty("zones-fill", "fill-opacity", fillOpacity);
  }, [fillOpacity, ready]);

  // ---- route lines and stations -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("routes") as maplibregl.GeoJSONSource | undefined)?.setData(routesGeoJson(lines));
    (map.getSource("stations") as maplibregl.GeoJSONSource | undefined)?.setData(stationsGeoJson(stations));
  }, [lines, stations, ready]);

  // ---- selection ----------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("zones-selected")) return;
    map.setFilter("zones-selected", ["==", ["get", "id"], selected ?? -1]);
    map.setFilter("zones-secondary", ["==", ["get", "id"], secondary ?? -1]);
    if (selected !== null && flyToSelected && zonesRef.current) {
      const f = zonesRef.current.features.find((x) => x.properties.id === selected);
      const b = f ? bbox(f.geometry) : null;
      if (b) {
        const view = map.getBounds();
        if (!(view.contains([b[0], b[1]]) && view.contains([b[2], b[3]]))) {
          map.fitBounds(b, { padding: 80, maxZoom: 12.5, duration: reducedMotion ? 0 : 800 });
        }
      }
    }
  }, [selected, secondary, ready, flyToSelected, reducedMotion]);

  // ---- fit to focus points -------------------------------------------------------------
  const focusKey = focus && focus.length ? JSON.stringify(focus) : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusKey) return;
    const pts = JSON.parse(focusKey) as [number, number][];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: 70, maxZoom: 13.5, duration: reducedMotion ? 0 : 900 },
    );
  }, [focusKey, ready, reducedMotion]);

  return (
    <div
      className={cn("bg-muted relative overflow-hidden", className)}
      role="region"
      aria-label={ariaLabel}
      aria-busy={status === "loading"}
    >
      {/* inline style: maplibre's unlayered CSS sets position: relative on this node */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {status === "loading" && (
        <div className="text-muted-foreground pointer-events-none absolute inset-0 grid place-items-center text-sm">
          <span className="animate-pulse">Loading map…</span>
        </div>
      )}
      {status === "error" && (
        <div className="text-muted-foreground absolute inset-0 grid place-items-center p-6 text-center text-sm">
          The taxi-zone boundaries could not be loaded. The tables on this page still work.
        </div>
      )}
      {status === "fallback" && (
        <p className="bg-card/90 text-muted-foreground absolute bottom-2 left-2 rounded px-2 py-1 text-[11px] shadow-sm">
          Basemap tiles unavailable: showing the bundled borough outlines.
        </p>
      )}
      {tip && (
        <div
          className="bg-popover text-popover-foreground pointer-events-none absolute z-10 max-w-64 rounded-md border px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.max(4, Math.min(tip.x + 14, tip.w - 260)), top: Math.max(tip.y - 10, 8) }}
        >
          <div className="font-semibold">{tip.title}</div>
          {tip.lines.map((l) => (
            <div key={l} className="text-muted-foreground font-mono text-[11px]">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function applyFills(map: maplibregl.Map, fills: Record<number, string>, applied: Set<number>) {
  const next = new Set<number>();
  for (const [k, color] of Object.entries(fills)) {
    const id = Number(k);
    next.add(id);
    map.setFeatureState({ source: "zones", id }, { fill: color });
  }
  for (const id of applied) if (!next.has(id)) map.setFeatureState({ source: "zones", id }, { fill: null });
  applied.clear();
  for (const id of next) applied.add(id);
}

function routesGeoJson(lines: RouteLine[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: lines.map((l): Feature<LineString> => ({
      type: "Feature",
      properties: { id: l.id, color: l.color, width: l.width },
      geometry: { type: "LineString", coordinates: l.coords },
    })),
  };
}

function stationsGeoJson(stations: Station[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: stations.map((s): Feature<Point> => ({
      type: "Feature",
      properties: { id: s.id, kind: s.kind },
      geometry: { type: "Point", coordinates: s.coord },
    })),
  };
}

function bbox(g: Polygon | MultiPolygon): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  for (const ring of rings)
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}
