import { cn } from "@/lib/utils";

/** An MTA-style route bullet: a coloured disc with a bold glyph. */
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
        "inline-grid size-9 shrink-0 place-items-center rounded-full text-base leading-none font-bold text-white",
        className,
      )}
      style={{ background: color }}
    >
      {glyph}
    </span>
  );
}
