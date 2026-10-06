"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal scroller for wide tables. When its content is wider than the box (on a phone),
 * it becomes a named, focusable region so keyboard users can reach it and scroll it with the
 * arrow keys (WCAG 2.1.1). When everything fits it stays a plain box, with no extra tab stop.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  /** Accessible name of the region, usually the table's caption. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("relative overflow-x-auto", className)}
      {...(scrolls ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
    >
      {children}
    </div>
  );
}
