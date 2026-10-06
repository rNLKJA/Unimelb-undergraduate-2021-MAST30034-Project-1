"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useId } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { formatCompact } from "@/lib/format";
import { hourLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Hour-of-day scrubber: a bar per hour (city-wide context), a range input for
 * keyboard users, an "all day" option (hour 24) and a play button.
 */
export function HourScrubber({
  hour,
  onHour,
  totals,
  playing,
  onPlaying,
  label = "Hour of day",
}: {
  /** 0-23, or 24 for the whole day */
  hour: number;
  onHour: (h: number) => void;
  /** 24 values used to draw the context bars */
  totals: number[] | null;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  label?: string;
}) {
  const id = useId();
  const reduced = usePrefersReducedMotion();
  const max = totals ? Math.max(...totals, 1) : 1;
  const allDay = hour === 24;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => onHour(hour >= 23 ? 0 : hour + 1), reduced ? 1600 : 900);
    return () => window.clearInterval(t);
  }, [playing, hour, onHour, reduced]);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="kicker text-muted-foreground">
          {label}
        </label>
        <span className="font-mono text-sm font-semibold tabular-nums" aria-live="polite">
          {allDay ? "All day" : `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`}
        </span>
      </div>
      <div className="flex h-12 items-end gap-[2px]" aria-hidden>
        {Array.from({ length: 24 }, (_, h) => {
          const v = totals?.[h] ?? 0;
          const on = allDay || h === hour;
          return (
            <button
              key={h}
              type="button"
              tabIndex={-1}
              onClick={() => {
                onPlaying(false);
                onHour(h);
              }}
              title={`${hourLabel(h)}: ${formatCompact(v)} trips`}
              className="group flex h-full flex-1 items-end"
            >
              <span
                className={cn(
                  "block w-full rounded-t-[2px] transition-[height,background-color] duration-300",
                  on ? "bg-taxi" : "bg-foreground/15 group-hover:bg-foreground/30",
                )}
                style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={23}
        step={1}
        value={allDay ? 12 : hour}
        onChange={(e) => {
          onPlaying(false);
          onHour(Number(e.target.value));
        }}
        aria-valuetext={allDay ? "All day" : hourLabel(hour)}
        className="accent-taxi w-full"
      />
      <div className="text-muted-foreground flex justify-between font-mono text-[10px]">
        <span>12 am</span>
        <span>6 am</span>
        <span>12 pm</span>
        <span>6 pm</span>
        <span>11 pm</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (allDay) onHour(0);
            onPlaying(!playing);
          }}
          className="hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium"
          aria-pressed={playing}
        >
          {playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {playing ? "Pause" : "Play the day"}
        </button>
        <button
          type="button"
          onClick={() => {
            onPlaying(false);
            onHour(24);
          }}
          aria-pressed={allDay}
          className={cn(
            "inline-flex items-center rounded-md border px-2.5 py-1.5 text-sm font-medium",
            allDay ? "bg-foreground text-background" : "hover:bg-muted",
          )}
        >
          All day
        </button>
      </div>
    </div>
  );
}
