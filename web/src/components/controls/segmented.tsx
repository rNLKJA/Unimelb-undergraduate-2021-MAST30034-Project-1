"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  title?: string;
}

/** Accessible single-choice control (radio group with roving focus and arrow keys). */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const onKey = (e: KeyboardEvent) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const next = (idx + d + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={className}>
      <span id={id} className="sr-only">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={onKey}
        className="bg-muted inline-flex w-full flex-wrap gap-0.5 rounded-md p-0.5"
      >
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex-1 rounded-[5px] font-medium whitespace-nowrap transition-colors",
                size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
                on
                  ? "bg-card text-foreground shadow-sm ring-1 ring-black/5"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
