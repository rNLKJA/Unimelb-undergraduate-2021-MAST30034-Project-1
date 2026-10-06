import { cn } from "@/lib/utils";

/**
 * An MTA-style route bullet: a coloured disc with a bold glyph. White glyphs on the
 * light theme's deep line colours; dark glyphs on the dark theme's brighter ones.
 */
export function LineBullet({
  glyph,
  color,
  className,
}: {
  glyph: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "dark:text-taxi-ink inline-grid size-9 shrink-0 place-items-center rounded-full text-base leading-none font-bold text-white",
        className,
      )}
      style={{ background: color }}
    >
      {glyph}
    </span>
  );
}
