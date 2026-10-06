import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Label + control stack used across the explorers. */
export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="kicker text-muted-foreground">
          {label}
        </label>
      ) : (
        <span className="kicker text-muted-foreground">{label}</span>
      )}
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export const selectClass =
  "border-input bg-card h-9 w-full rounded-md border px-2.5 text-sm shadow-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
