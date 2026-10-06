import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-3xl place-items-center px-4 py-24 text-center">
      <p className="kicker text-taxi-text">404 · Off duty</p>
      <h1 className="font-condensed mt-2 text-6xl font-extrabold uppercase">No fare at this address</h1>
      <p className="text-muted-foreground mt-4 font-serif text-lg">
        The page you hailed doesn&apos;t exist. The meter is off; try one of these instead.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="bg-taxi text-taxi-ink rounded-md px-4 py-2 font-semibold">
          Home
        </Link>
        <Link href="/map" className="hover:bg-muted rounded-md border px-4 py-2 font-semibold">
          Zone map
        </Link>
        <Link href="/records" className="hover:bg-muted rounded-md border px-4 py-2 font-semibold">
          Records
        </Link>
      </div>
    </div>
  );
}
