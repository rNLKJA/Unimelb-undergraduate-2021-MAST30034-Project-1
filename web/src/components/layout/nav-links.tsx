"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/site";
import { cn } from "@/lib/utils";

export function NavLinks({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className={className}>
      {NAV.map((item) => {
        const active = [item.href, ...(item.also ?? [])].some(
          (h) => pathname === h || pathname.startsWith(`${h}/`),
        );
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative block rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active ? "text-foreground" : "text-foreground/70 hover:text-foreground hover:bg-muted",
                active &&
                  "after:bg-taxi max-xl:bg-muted after:absolute after:inset-x-2.5 after:-bottom-[13px] after:h-[3px] after:rounded-full max-xl:after:hidden",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
