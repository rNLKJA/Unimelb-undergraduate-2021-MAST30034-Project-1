"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useThemeName } from "@/hooks/use-theme-name";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  // "light" during SSR and hydration, the real theme once mounted: no attribute mismatch
  const dark = useThemeName() === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="text-foreground/80 hover:text-foreground hover:bg-muted grid size-9 place-items-center rounded-md transition-colors"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Newsprint (light)" : "Asphalt (dark)"}
    >
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
    </button>
  );
}
