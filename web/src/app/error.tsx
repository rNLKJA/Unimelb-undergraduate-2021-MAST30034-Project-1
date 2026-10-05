"use client";

import Link from "next/link";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto grid max-w-3xl place-items-center px-4 py-24 text-center">
      <p className="kicker text-taxi-text">Engine trouble</p>
      <h1 className="font-condensed mt-2 text-5xl font-extrabold uppercase">This page broke down</h1>
      <p className="text-muted-foreground mt-4 font-serif text-lg">
        Something went wrong while loading the data. Try again, or head back to the start.
      </p>
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-taxi text-taxi-ink rounded-md px-4 py-2 font-semibold"
        >
          Try again
        </button>
        <Link href="/" className="hover:bg-muted rounded-md border px-4 py-2 font-semibold">
          Home
        </Link>
      </div>
    </div>
  );
}
