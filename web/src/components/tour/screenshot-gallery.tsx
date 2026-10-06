"use client";

import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { SCREENSHOT_SIZE, type Screenshot, screenshotSrc, thumbnailSrc } from "@/lib/showcase";
import { cn } from "@/lib/utils";

const GROUPS = [
  { viewport: "desktop", label: "Desktop · 1440 × 900" },
  { viewport: "mobile", label: "Phone · 390 × 844" },
] as const;

function Thumbnail({ shot, onOpen }: { shot: Screenshot; onOpen: () => void }) {
  const size = SCREENSHOT_SIZE[shot.viewport];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Enlarge screenshot: ${shot.title}`}
      className="group bg-card hover:border-foreground/40 focus-visible:ring-ring flex h-full w-full flex-col overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-2"
    >
      <span
        className={cn(
          "bg-muted relative block w-full overflow-hidden border-b",
          shot.viewport === "mobile" ? "aspect-[390/600]" : "aspect-[1440/900]",
        )}
      >
        <Image
          src={thumbnailSrc(shot.id)}
          alt=""
          width={size.thumbWidth}
          height={size.thumbHeight}
          unoptimized
          className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span className="bg-background/90 absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Expand className="size-3.5" aria-hidden />
        </span>
      </span>
      <span className="block p-3">
        <span className="block text-sm font-semibold">{shot.title}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{shot.caption}</span>
      </span>
    </button>
  );
}

/**
 * Screenshot grid with a lightbox: each thumbnail is a button that opens the
 * full image in a native modal dialog (focus moves into it, Escape closes it
 * and focus returns to the thumbnail; the arrow keys or the buttons step
 * through the set).
 */
export function ScreenshotGallery({ items }: { items: readonly Screenshot[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const current = open === null ? null : items[open];
  const step = (delta: number) =>
    setOpen((i) => (i === null ? i : (i + delta + items.length) % items.length));

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);

  return (
    <>
      <div className="grid gap-8">
        {GROUPS.map((g) => (
          <div key={g.viewport}>
            <h3 className="kicker text-muted-foreground mb-3">{g.label}</h3>
            <ul
              className={cn(
                "grid gap-4",
                g.viewport === "desktop"
                  ? "sm:grid-cols-2 lg:grid-cols-3"
                  : "grid-cols-2 sm:grid-cols-3 lg:max-w-3xl",
              )}
            >
              {items.map((s, i) =>
                s.viewport !== g.viewport ? null : (
                  <li key={s.id}>
                    <Thumbnail shot={s} onOpen={() => setOpen(i)} />
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="lightbox-title"
        aria-describedby="lightbox-caption"
        onClose={() => setOpen(null)}
        onClick={(e) => {
          // a click on the backdrop closes the lightbox
          if (e.target === dialog.current) setOpen(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        className={cn(
          "bg-background text-foreground m-auto w-[min(92vw,1180px)] rounded-lg border p-0 shadow-2xl backdrop:bg-black/70",
          current?.viewport === "mobile" && "w-[min(92vw,460px)]",
        )}
      >
        {current && (
          <div className="grid gap-3 p-3 sm:p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="lightbox-title" className="font-condensed text-2xl font-bold uppercase">
                  {current.title}
                </h2>
                <p id="lightbox-caption" className="text-muted-foreground text-sm">
                  {current.caption}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="hover:bg-muted grid size-9 shrink-0 place-items-center rounded-md"
                aria-label="Close screenshot"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <Image
              key={current.id}
              src={screenshotSrc(current.id)}
              alt={`${current.title}: ${current.caption}`}
              width={SCREENSHOT_SIZE[current.viewport].width}
              height={SCREENSHOT_SIZE[current.viewport].height}
              unoptimized
              className="max-h-[calc(100svh-12rem)] w-full rounded-md border object-contain"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
              >
                <ChevronLeft className="size-4" aria-hidden /> Previous
              </button>
              <span className="text-muted-foreground font-mono text-xs" aria-live="polite">
                {(open ?? 0) + 1} / {items.length}
              </span>
              <button
                type="button"
                onClick={() => step(1)}
                className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
              >
                Next <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
