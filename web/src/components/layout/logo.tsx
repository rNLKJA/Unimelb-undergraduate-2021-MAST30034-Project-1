import Link from "next/link";

/** Wordmark: a taxi roof light with the medallion-style year. */
export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5 rounded-md" aria-label="NYC Taxi 2019, home">
      <span
        aria-hidden
        className="bg-taxi text-taxi-ink font-condensed relative grid h-7 place-items-center rounded-[5px] px-2 text-[15px] leading-none font-extrabold tracking-wide shadow-[inset_0_-3px_0_rgba(0,0,0,0.18)]"
      >
        TAXI
      </span>
      <span className="font-condensed text-lg leading-none font-bold tracking-tight uppercase">
        NYC <span className="text-taxi-text">&rsquo;19</span>
      </span>
    </Link>
  );
}
